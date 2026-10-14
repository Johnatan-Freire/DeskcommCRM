/**
 * LGPD (#2191 do upstream) — `workers/ai-sentiment-worker.ts` não regrava a
 * metadata de uma mensagem anonimizada durante a medição do clima.
 *
 * A corrida: o worker lê a mensagem, o contato é anonimizado enquanto o modelo
 * classifica (body vira o sentinela, metadata vira `{}`), e o UPDATE regravaria
 * a foto antiga da metadata mais a nota. O UPDATE só casa enquanto
 * `body IS DISTINCT FROM MENSAGEM_REDIGIDA`.
 *
 * No upstream a prova mora em `clima-da-conversa-no-worker.test.ts`, que nasceu
 * com o Jev (não portado); aqui o banco é um dublê mínimo com o MESMO operador.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processSentiment } from "@/workers/ai-sentiment-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { MENSAGEM_REDIGIDA } from "@/lib/lgpd/cascata";
import { generateObject } from "ai";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/gateway", () => ({
  DEFAULT_CLASSIFIER_MODEL: "anthropic/claude-haiku-4-5",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  isAiGatewayConfigured: () => true,
  resolveLanguageModel: (model: string) => model,
}));
vi.mock("ai", () => ({ generateObject: vi.fn() }));
// O caminho até a classificação, reduzido ao que ESTE teste mede: modelo
// resolvido, conversa elegível e um agente no ar.
vi.mock("@/lib/ai/gateway-binding", () => ({
  resolverModeloDoPonto: vi.fn(async () => ({ model: "modelo-de-teste", modelId: "anthropic/claude-haiku-4-5" })),
}));
vi.mock("@/lib/ai/elegibilidade/consulta-supabase", () => ({
  decidirElegibilidadeDaConversaViaSupabase: vi.fn(async () => null),
}));
vi.mock("@/lib/ai/agents/no-ar", () => ({ agenteAtende: () => true, precisaRecuperarLegado: () => false }));
vi.mock("@/lib/ai/agents/agente-da-conversa", () => ({
  resolverAgenteDaConversa: () => ({ agente: { id: "agente-1", config: {} }, motivo: "teste" }),
}));
vi.mock("@/lib/ai/log-invocation", () => ({ logInvocation: vi.fn() }));
vi.mock("@/lib/ai/cost", () => ({ computeCost: vi.fn(async () => 0) }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";
const MSG_ID = "55555555-5555-4555-8555-555555555555";

type Linha = Record<string, unknown>;

/** Banco mínimo: lê `messages` e aplica o UPDATE só onde os filtros casam. */
function banco(mensagem: Linha) {
  const updates: Array<{ patch: Linha; aplicado: boolean }> = [];
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let patch: Linha | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {
      select: () => c,
      eq: (col: string, val: unknown) => (filtros.push((l) => l[col] === val), c),
      order: () => c,
      limit: () => c,
      in: () => c,
      is: () => c,
      // Só o operador que o worker usa: `isdistinct` casa NULL (é `IS DISTINCT
      // FROM`), e um operador desconhecido explode em vez de casar tudo calado.
      filter: (col: string, op: string, val: unknown) => {
        if (op !== "isdistinct") throw new Error(`filter não emulado: ${op}`);
        return (filtros.push((l) => (l[col] ?? null) !== val), c);
      },
      update: (p: Linha) => ((patch = p), c),
      maybeSingle: () =>
        Promise.resolve({
          data:
            tabela === "messages"
              ? { ...mensagem }
              : tabela === "conversations"
                ? { id: CONV_ID, channel_session_id: null, active_ai_agent_id: null }
                : null,
          error: null,
        }),
      then: (resolve: (v: unknown) => unknown) => {
        if (!patch && tabela === "ai_agents") return resolve({ data: [{ id: "agente-1" }], error: null });
        if (patch && tabela === "messages") {
          const casa = filtros.every((f) => f(mensagem));
          if (casa) Object.assign(mensagem, patch);
          updates.push({ patch, aplicado: casa });
        }
        return resolve({ data: null, error: null });
      },
    };
    return c;
  };
  const rpc = async () => ({ data: "autorizado", error: null });
  return { cliente: { from, rpc }, updates };
}

const eventRow = {
  organization_id: ORG_ID,
  entity_id: MSG_ID,
  payload: { message_id: MSG_ID, conversation_id: CONV_ID },
} as unknown as EventRow;

beforeEach(() => vi.clearAllMocks());

describe("LGPD: a nota não volta para uma mensagem anonimizada durante a medição", () => {
  function mensagemViva(): Linha {
    return {
      id: MSG_ID,
      body: "estou esperando há horas",
      direction: "inbound",
      conversation_id: CONV_ID,
      organization_id: ORG_ID,
      metadata: { push_name: "Maria Silva" },
      channel_session_id: null,
      sent_at: new Date().toISOString(),
    };
  }

  it("lê → anonimiza → grava: metadata continua `{}`", async () => {
    const msg = mensagemViva();
    const { cliente, updates } = banco(msg);
    vi.mocked(createAdminClient).mockReturnValue(cliente as never);
    vi.mocked(generateObject).mockImplementationOnce((async () => {
      Object.assign(msg, { body: MENSAGEM_REDIGIDA, metadata: {} });
      return { object: { sentiment_score: 0.2, reasoning_short: "irritado" }, usage: {} };
    }) as unknown as typeof generateObject);

    await processSentiment(eventRow);

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((u) => !u.aplicado)).toBe(true);
    expect(msg.metadata).toEqual({});
  });

  it("controle: sem anonimização no meio, a nota é gravada", async () => {
    const msg = mensagemViva();
    const { cliente } = banco(msg);
    vi.mocked(createAdminClient).mockReturnValue(cliente as never);
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { sentiment_score: 0.9, reasoning_short: "tranquilo" },
      usage: {},
    } as never);

    await processSentiment(eventRow);

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(msg.metadata).toMatchObject({ push_name: "Maria Silva" });
    expect(Object.keys(msg.metadata as Linha).length).toBeGreaterThan(1);
  });
});
