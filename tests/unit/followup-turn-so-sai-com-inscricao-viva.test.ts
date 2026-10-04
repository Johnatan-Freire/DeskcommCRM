/**
 * O TURNO DE FLUXO SÓ SAI COM A INSCRIÇÃO VIVA.
 *
 * ## O defeito (a parte não medida da #1913)
 *
 * Apagar um fluxo pela rota (`DELETE /api/v1/ai/followups/flows/:id`) apaga a
 * inscrição (`followup_enrollments`), mas NÃO toca no turno já enfileirado
 * (`job_queue`, `kind='followup_turn'`; e o `cron_jobs` do adiamento para a
 * janela de envio, que materializa outro turno depois). O worker então reclamava
 * o turno e o caminho de envio NÃO consultava a inscrição antes do efeito: o
 * `completeTurnForEnrollment` a consulta DEPOIS do envio e, sem inscrição,
 * devolve cedo — a mensagem do fluxo apagado já teria saído, calada, com o job
 * terminando `done`.
 *
 * O caminho inline (`enviarTextoFixoPendente`, cron sem agent-worker) já
 * descarta o turno quando a inscrição sumiu/foi cancelada/está em outro nó —
 * é a MESMA régua que este arquivo cobra do worker.
 *
 * ## O que este arquivo prende
 *
 * - inscrição apagada, cancelada/pausada ou em outro nó ⇒ o turno termina SEM
 *   tocar a cadeia de envio e SEM completar o enrollment;
 * - controle: inscrição viva no MESMO nó ⇒ o envio acontece e o turno completa.
 *
 * ## O que NÃO prova
 *
 * Nada com Postgres real: a checagem é do handler, e o dublê de pool só modela
 * as linhas que o Postgres devolveria em cada cenário.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRow } from "@/lib/agent-engine/queue/queue";

const runBeforeSend = vi.fn(async (args: Record<string, unknown>) => {
  await (args.send as (b: string) => Promise<unknown>)(args.body as string);
  return { status: "sent", outcome: { kind: "sent" }, trace: [] };
});
vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({ runBeforeSend }));

vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({
  isLeadInHandoff: vi.fn(async () => false),
}));

vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: vi.fn(async () => ({
    ok: true,
    context: { contact: { is_blocked: false } },
    lgpd: { isAnonymized: false, isProspecting: false, legalBasis: {} },
  })),
}));

const runAgentTurn = vi.fn(async () => undefined);
vi.mock("@/lib/agent-engine/agent/inbound-turn", async (original) => ({
  ...(await original<typeof import("@/lib/agent-engine/agent/inbound-turn")>()),
  runAgentTurn,
}));
vi.mock("@/lib/agent-engine/edge/crm/send-ledger", () => ({
  resultadoDoEnvioDoFollowup: vi.fn(async () => ({ kind: "sent" })),
}));

const ORG = "org-1";
const LEAD = "lead-1";
const CONVERSA = "conversa-1";
const CANAL = "canal-1";
const INSCRICAO = "11111111-1111-4111-8111-111111111111";
const NO = "passo";

const boundary = {
  organization_id: ORG,
  contact_id: LEAD,
  conversation_id: CONVERSA,
  service_revision: 1,
  demanda_id: null,
  demanda_revision: null,
};

function job(): JobRow {
  return {
    id: "job-1",
    organization_id: ORG,
    contact_id: LEAD,
    kind: "followup_turn",
    source_event_id: null,
    payload: {
      followup_enrollment_id: INSCRICAO,
      node_id: NO,
      purpose: "send_message",
      fixed_body: "Oi! Passando para retomar.",
      service_boundary: boundary,
    },
    status: "running",
    priority: 0,
    run_after: new Date(),
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    locked_by: "w1",
    locked_at: new Date(),
    created_at: new Date(),
  } as JobRow;
}

/** `null` = a inscrição não existe mais (fluxo apagado / cascata). */
interface Cenario {
  inscricao: { current_node_id: string; status: string } | null;
}

function fakePool(c: Cenario) {
  const query = vi.fn(async (sql: string): Promise<{ rows: Array<Record<string, unknown>> }> => {
    // Regra do fork (0403): o turno de follow-up consulta o corte de envio no
    // banco antes de sair. Este arquivo mede a inscrição viva, não o corte —
    // aqui o corte autoriza.
    if (sql.includes("fn_followup_pode_enviar")) return { rows: [{ motivo: "autorizado" }] };
    if (sql.includes("d.fechada_em::text"))
      return { rows: [{ ...boundary, status: "open", demanda_fechada_em: null }] };
    if (/from conversations/.test(sql))
      return { rows: [{ id: CONVERSA, channel_session_id: CANAL, archived_at: null }] };
    // A checagem da inscrição: distinta da janela do agente (`from followup_enrollments e`).
    if (/from followup_enrollments/.test(sql) && !/left join ai_agents/.test(sql)) {
      return { rows: c.inscricao ? [{ ...c.inscricao }] : [] };
    }
    return { rows: [] };
  });
  return { query } as never;
}

function deps() {
  const send = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));
  const completeFollowupTurn = vi.fn(async () => undefined);
  const d = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    crmCfg: {},
    llmCfg: {},
    knobs: {},
    channel: () => ({ send }),
    completeFollowupTurn,
  } as never;
  return { d, send, completeFollowupTurn };
}

let criarHandler: typeof import("@/lib/agent-engine/agent/followup-turn").createFollowupTurnHandler;

beforeAll(async () => {
  ({ createFollowupTurnHandler: criarHandler } =
    await import("@/lib/agent-engine/agent/followup-turn"));
}, 60_000);

beforeEach(() => {
  runBeforeSend.mockClear();
  runAgentTurn.mockClear();
});

describe("o turno de fluxo diante da inscrição que não está mais viva", () => {
  it("inscrição apagada (fluxo apagado pela rota): não envia nada", async () => {
    const { d, send, completeFollowupTurn } = deps();
    await criarHandler(d)(job(), fakePool({ inscricao: null }), { workerId: "w1" });

    expect(
      runBeforeSend,
      "a cadeia de envio foi tocada para um fluxo que não existe mais",
    ).not.toHaveBeenCalled();
    expect(send, "a mensagem do fluxo apagado saiu para o lead").not.toHaveBeenCalled();
    expect(
      completeFollowupTurn,
      "o turno completou contra uma inscrição que não existe",
    ).not.toHaveBeenCalled();
  });

  it("inscrição cancelada pela fila: não envia nada", async () => {
    const { d, send } = deps();
    await criarHandler(d)(
      job(),
      fakePool({ inscricao: { current_node_id: NO, status: "cancelled" } }),
      { workerId: "w1" },
    );

    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("inscrição pausada: não envia nada", async () => {
    const { d, send } = deps();
    await criarHandler(d)(
      job(),
      fakePool({ inscricao: { current_node_id: NO, status: "paused_manual" } }),
      { workerId: "w1" },
    );

    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("inscrição andou para outro nó: não envia nada", async () => {
    const { d, send } = deps();
    await criarHandler(d)(
      job(),
      fakePool({ inscricao: { current_node_id: "outro-no", status: "active" } }),
      { workerId: "w1" },
    );

    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("controle: inscrição viva no MESMO nó envia e completa", async () => {
    const { d, send, completeFollowupTurn } = deps();
    await criarHandler(d)(
      job(),
      fakePool({ inscricao: { current_node_id: NO, status: "active" } }),
      { workerId: "w1" },
    );

    expect(runBeforeSend).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(completeFollowupTurn).toHaveBeenCalledTimes(1);
  });
});
