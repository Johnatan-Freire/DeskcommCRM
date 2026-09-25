/**
 * Corte de conexão (migration 0398) — caminho pré-engine (org SEM agente
 * publicado, `workers/ai-response-worker.ts`). Irmão do teste equivalente em
 * `lib/agent-engine/edge/crm/drain.test.ts`, que cobre o caminho com engine.
 *
 * WAHA/NOWEB sincroniza histórico do WhatsApp ao parear uma sessão nova, e o
 * mesmo webhook que entrega mensagem NOVA entrega a ANTIGA também, sem nada
 * que distinga as duas. `channel_sessions.first_connected_at` é o corte
 * gravado uma única vez pelo trigger `fn_marcar_primeira_conexao`; mensagem
 * com `sent_at` (horário REAL do WhatsApp) anterior a ele nunca pode gerar
 * resposta — exigência explícita do dono do produto antes de conectar um
 * cliente real, para não responder pergunta de semanas atrás com o texto de
 * hoje.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processMessageReceived } from "@/workers/ai-response-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/event-log/dispatcher";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/ai/gateway", () => ({
  DEFAULT_BOT_MODEL: "anthropic/claude-sonnet-5",
  gatewayConfig: {},
  gatewayHeaders: () => ({}),
  isAiGatewayConfigured: () => true,
  isEmbeddingProviderConfigured: () => false,
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";
const MSG_ID = "55555555-5555-4555-8555-555555555555";
const SESSION_ID = "77777777-7777-4777-8777-777777777777";

interface StubTables {
  conversations: Record<string, unknown> | null;
  messages: Record<string, unknown> | null;
  channel_sessions: Record<string, unknown> | null;
}

function makeAdminStub(tables: StubTables, queried: string[]) {
  const from = (table: string) => {
    const result =
      table === "conversations"
        ? tables.conversations
        : table === "messages"
          ? tables.messages
          : table === "channel_sessions"
            ? tables.channel_sessions
            : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: result, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: result ? [result] : [], error: null }).then(resolve),
    };
    queried.push(table);
    return chain;
  };
  return { from };
}

function convRow() {
  return {
    id: CONV_ID,
    organization_id: ORG_ID,
    contact_id: "66666666-6666-4666-8666-666666666666",
    channel_session_id: SESSION_ID,
    last_inbound_at: new Date().toISOString(),
    bot_silenced_until: null,
    last_handoff_at: null,
    assignee_kind: "ai",
    contacts: {
      id: "66666666-6666-4666-8666-666666666666",
      display_name: null, // sem PII em teste (LGPD)
      locale: "pt-BR",
      is_blocked: false,
      force_human: false,
    },
  };
}

function msgRow(sentAt: string) {
  return { id: MSG_ID, body: "oi", direction: "inbound", organization_id: ORG_ID, sent_at: sentAt };
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

describe("corte de conexão (migration 0398) — caminho pré-engine", () => {
  it("mensagem anterior à conexão: skip 'message_before_connection', ANTES de consultar agente", async () => {
    const queried: string[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub(
        {
          conversations: convRow(),
          messages: msgRow("2026-09-01T10:00:00.000Z"), // 20 dias antes de conectar
          channel_sessions: { first_connected_at: CONECTOU_EM },
        },
        queried,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    );

    const result = await processMessageReceived(eventRow);

    expect(result).toEqual({ status: "skipped", reason: "message_before_connection" });
    expect(queried).not.toContain("ai_agents");
  });

  it("mensagem posterior à conexão: o corte NÃO veta — pipeline avança", async () => {
    const queried: string[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub(
        {
          conversations: convRow(),
          messages: msgRow("2026-09-21T12:00:00.000Z"), // 2h depois de conectar
          channel_sessions: { first_connected_at: CONECTOU_EM },
        },
        queried,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    );

    const result = await processMessageReceived(eventRow);

    // Avançou além do corte: próximo guard determinístico (sem ai_agents no stub).
    expect(result.reason).toBe("agent_inactive_or_missing");
  });

  it("sessão sem first_connected_at (já conectada antes da migration 0398): nenhum corte, comportamento de sempre", async () => {
    const queried: string[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub(
        {
          conversations: convRow(),
          messages: msgRow("2020-01-01T00:00:00.000Z"), // bem antigo, mas sem corte para comparar
          channel_sessions: { first_connected_at: null },
        },
        queried,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    );

    const result = await processMessageReceived(eventRow);

    expect(result.reason).not.toBe("message_before_connection");
    expect(result.reason).toBe("agent_inactive_or_missing");
  });
});
