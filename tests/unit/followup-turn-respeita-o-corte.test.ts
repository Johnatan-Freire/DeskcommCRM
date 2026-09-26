/**
 * O `followup_turn` do engine consulta o corte ANTES de enviar (migration 0403).
 *
 * O incidente (produção, 2026-09-26): lembretes do fluxo "Lead sem resposta"
 * saíram com o agente pausado havia 16h, para conversas encerradas por humano.
 * Pausar o agente ou desligar o fluxo não parava a inscrição que já estava viva:
 * nada entre a inscrição e o envio perguntava se o atendimento automático ainda
 * era quem conduzia a conversa. A régua é `fn_followup_pode_enviar` (medida
 * contra Postgres real em `tests/invariants/corte-temporal-de-ativacao.test.ts`);
 * aqui se mede que o turno A CONSULTA e obedece — recusa não envia e fecha a
 * inscrição como `skipped`; erro não envia.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRow } from "@/lib/agent-engine/queue/queue";

const ORG = "org-1";
const LEAD = "lead-1";
const CONVERSA = "conversa-1";
const ENROLLMENT = "11111111-1111-4111-8111-111111111111";

const chain = vi.fn(async (_args: Record<string, unknown>) =>
  ({ status: "sent", outcome: { kind: "sent" }, trace: [] }) as unknown as Record<string, unknown>);
vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({
  runBeforeSend: (args: Record<string, unknown>) => chain(args),
}));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ isLeadInHandoff: vi.fn(async () => false) }));
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: vi.fn(async () => ({
    ok: true,
    context: { contact: { is_blocked: false } },
    lgpd: { isAnonymized: false, isProspecting: false, legalBasis: {} },
  })),
}));
vi.mock("@/lib/agent-engine/cron/scheduler", () => ({ scheduleCronJob: vi.fn(async () => undefined) }));

const boundary = {
  organization_id: ORG, contact_id: LEAD, conversation_id: CONVERSA,
  service_revision: 1, demanda_id: null, demanda_revision: null,
};

const job = {
  id: "job-1", organization_id: ORG, contact_id: LEAD, kind: "followup_turn", source_event_id: null,
  payload: {
    followup_enrollment_id: ENROLLMENT, node_id: "a1", purpose: "send_message",
    fixed_body: "Oi! Vi que você tinha interesse em um dos nossos cursos…",
    service_boundary: boundary,
  },
  status: "running", priority: 0, run_after: new Date(), attempts: 1, max_attempts: 3,
  last_error: null, locked_by: "w1", locked_at: new Date(), created_at: new Date(),
} as unknown as JobRow;

function pool(corte: string | Error) {
  const perguntas: unknown[][] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("fn_followup_pode_enviar")) {
      perguntas.push(values);
      if (corte instanceof Error) throw corte;
      return { rows: [{ motivo: corte }] };
    }
    if (sql.includes("d.fechada_em::text")) return { rows: [{ ...boundary, status: "open", demanda_fechada_em: null }] };
    if (/from conversations/.test(sql)) return { rows: [{ id: CONVERSA, channel_session_id: "canal-1", archived_at: null }] };
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as never, perguntas };
}

function deps() {
  const completeFollowupTurn = vi.fn(async () => undefined);
  return {
    deps: {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      crmCfg: {}, llmCfg: {}, knobs: {},
      channel: () => ({ send: vi.fn(async () => ({ ok: true })) }),
      completeFollowupTurn,
    } as never,
    completeFollowupTurn,
  };
}

let criar: typeof import("@/lib/agent-engine/agent/followup-turn").createFollowupTurnHandler;
beforeAll(async () => {
  ({ createFollowupTurnHandler: criar } = await import("@/lib/agent-engine/agent/followup-turn"));
}, 60_000);
beforeEach(() => chain.mockClear());

describe("followup_turn × corte de atendimento automático", () => {
  it.each(["nenhum_agente_no_ar", "humano_falou_por_ultimo", "fluxo_desligado", "humano_atendendo"])(
    "⭐ recusa (%s): NÃO envia e fecha a inscrição como skipped, com o motivo legível",
    async (motivo) => {
      const { pool: p, perguntas } = pool(motivo);
      const { deps: d, completeFollowupTurn } = deps();
      await criar(d)(job, p, { workerId: "w1" });
      expect(chain, "a cadeia de envio não pode nem ser alcançada").not.toHaveBeenCalled();
      expect(perguntas).toEqual([[ORG, ENROLLMENT]]);
      const entrada = (completeFollowupTurn.mock.calls[0] as unknown[])[1] as { result: { kind: string; reason: string } };
      expect(entrada.result.kind).toBe("skipped");
      expect(entrada.result.reason).toMatch(/^Não enviado: /);
    },
  );

  it("erro da consulta: lança (o job re-tenta) e NÃO envia", async () => {
    const { pool: p } = pool(new Error("db down"));
    const { deps: d, completeFollowupTurn } = deps();
    await expect(criar(d)(job, p, { workerId: "w1" })).rejects.toThrow(/db down/);
    expect(chain).not.toHaveBeenCalled();
    expect(completeFollowupTurn).not.toHaveBeenCalled();
  });

  it("CONTROLE: autorizado, o texto fixo chega à cadeia de envio", async () => {
    const { pool: p } = pool("autorizado");
    const { deps: d, completeFollowupTurn } = deps();
    await criar(d)(job, p, { workerId: "w1" });
    expect(chain).toHaveBeenCalledTimes(1);
    const entrada = (completeFollowupTurn.mock.calls[0] as unknown[])[1] as { result: { kind: string } };
    expect(entrada.result.kind).toBe("sent");
  });
});
