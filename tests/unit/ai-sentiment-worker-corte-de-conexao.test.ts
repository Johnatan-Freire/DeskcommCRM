/**
 * Corte de conexão (migration 0398) — `workers/ai-sentiment-worker.ts`.
 *
 * O achado mais grave da auditoria pré-conexão: `ai.sentiment_alert` (emitido
 * por este worker) dispara `workers/ai-handoff-from-sentiment.handler.ts` →
 * `triggerHandoff` → `avisarLeadDoCrm` — que ENVIA uma mensagem real ao
 * contato ("um atendente vai assumir a conversa"), sem depender de a
 * organização ter agente publicado. Sem este guard, uma reclamação antiga
 * sincronizada pelo WAHA ao conectar, classificada como sentimento negativo,
 * mandaria esse aviso para um contato que não escreveu nada agora.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processSentiment } from "@/workers/ai-sentiment-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/event-log/dispatcher";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
// `lib/ai/gateway-binding.ts` (usado por `resolverModeloDoPonto`, chamado logo
// no início de `processSentiment`, ANTES do corte) importa deste MESMO módulo
// — precisa de `resolveLanguageModel`/`OPENROUTER_BASE_URL` além do que o
// worker usa direto, senão o mock incompleto derruba a função com um erro que
// o catch global engole, mascarado de "classify_failed".
vi.mock("@/lib/ai/gateway", () => ({
  DEFAULT_CLASSIFIER_MODEL: "anthropic/claude-haiku-4-5",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  isAiGatewayConfigured: () => true,
  resolveLanguageModel: (model: string) => model,
}));
// A 2ª asserção precisa o pipeline avançar ALÉM do corte — sem mock aqui,
// `generateObject` faria uma chamada de rede real (5s de timeout interno)
// contra uma chave falsa, só para o teste concluir "não foi o corte". O ponto
// deste arquivo é o corte, não o classificador — mockado, o teste fica rápido
// e determinístico.
vi.mock("ai", () => ({
  generateObject: vi.fn(async () => ({
    object: { sentiment_score: 0.8, reasoning_short: "neutro" },
    usage: {},
  })),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";
const MSG_ID = "55555555-5555-4555-8555-555555555555";
const SESSION_ID = "77777777-7777-4777-8777-777777777777";

interface StubTables {
  messages: Record<string, unknown> | null;
  channel_sessions: Record<string, unknown> | null;
}

function makeAdminStub(tables: StubTables, queried: string[]) {
  const from = (table: string) => {
    const result =
      table === "messages" ? tables.messages : table === "channel_sessions" ? tables.channel_sessions : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: result, error: null }),
    };
    queried.push(table);
    return chain;
  };
  return { from };
}

function msgRow(sentAt: string) {
  return {
    id: MSG_ID,
    body: "reclamação antiga",
    direction: "inbound",
    conversation_id: CONV_ID,
    organization_id: ORG_ID,
    metadata: {},
    channel_session_id: SESSION_ID,
    sent_at: sentAt,
  };
}

const eventRow = {
  organization_id: ORG_ID,
  entity_id: MSG_ID,
  payload: { message_id: MSG_ID, conversation_id: CONV_ID },
} as unknown as EventRow;

beforeEach(() => {
  vi.clearAllMocks();
});

const CONECTOU_EM = "2026-09-21T10:00:00.000Z";

describe("corte de conexão (migration 0398) — ai-sentiment-worker", () => {
  it("mensagem anterior à conexão: skip 'message_before_connection', ANTES de chamar o LLM", async () => {
    const queried: string[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub(
        {
          messages: msgRow("2026-09-01T10:00:00.000Z"), // 20 dias antes de conectar
          channel_sessions: { first_connected_at: CONECTOU_EM },
        },
        queried,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    );

    const result = await processSentiment(eventRow);

    expect(result).toEqual({ skipped: true, reason: "message_before_connection" });
    // Chegou a consultar o agente (que resolveria o threshold) NUNCA — provaria
    // que o corte vetou antes de qualquer trabalho de classificação.
    expect(queried).not.toContain("ai_agents");
  });

  it("sessão sem first_connected_at (já conectada antes da migration 0398): nenhum corte", async () => {
    const queried: string[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub(
        {
          messages: msgRow("2020-01-01T00:00:00.000Z"),
          channel_sessions: { first_connected_at: null },
        },
        queried,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    );

    const result = await processSentiment(eventRow);

    expect(result.reason).not.toBe("message_before_connection");
  });
});
