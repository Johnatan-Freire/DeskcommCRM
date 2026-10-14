/**
 * O destino de funil da intenção do roteador (upstream #2290, issue #2155)
 * diante das regras da Capital Code (migration 0404, política por etapa).
 *
 * O upstream leva o card ao funil da intenção em todo turno roteado. No fork,
 * três travas — cada uma vigiada aqui:
 *
 *   1. a etapa do contato: só etapa COMERCIAL deixa o roteador mover o card —
 *      acadêmica, só-humana e terminal não (quem decide o funil ali é a equipe);
 *   2. a intenção casada era do agente acadêmico, recusado em etapa comercial:
 *      o destino dela não vale para o comercial que assume;
 *   3. a transferência (automação e roteador) recusa origem em etapa
 *      `exit_locked` ANTES de clonar — o gatilho `trg_crm_leads_trava_de_saida`
 *      só recusaria o encerramento, com o clone já criado: dois negócios abertos.
 *
 * A régua do agente (comercial com `can_update_lead_state`) mora em
 * `inbound-turn.ts`, junto da chamada, e é a mesma de `update_lead_state`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createLead: vi.fn(), encerra: vi.fn() }));
vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: mocks.createLead }));
vi.mock("@/lib/leads/encerramento", () => ({ encerraDemanda: mocks.encerra }));

import type { PublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";
import type { LoadedRouter } from "@/lib/agent-engine/agent/router-config";
import { resolveConversationTurn } from "@/lib/agent-engine/agent/resolve-turn-agent";
import { transfereParaOFunil } from "@/lib/leads/transfere-para-o-funil";

// ─── 1 e 2: o resolvedor só entrega destino em etapa comercial ──────────────

function config(agentId: string, serviceScope: "comercial" | "academico"): PublishedAgentConfig {
  return { agentId, versionId: `v-${agentId}`, serviceScope, canUpdateLeadState: serviceScope === "comercial" } as PublishedAgentConfig;
}

function roteador(agentId: string): LoadedRouter {
  return {
    id: "router-1",
    name: "R",
    classifierModel: null,
    classifierProvider: null,
    sticky: false,
    minConfidence: 0.6,
    fallbackAgentId: null,
    members: [
      {
        agentId,
        intentName: "investir",
        intentDescription: "quer investir",
        examples: [],
        destinationPipelineId: "pipe-investimentos",
        destinationStageId: "stage-investimentos-1",
      },
    ],
  };
}

function dbFalso() {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from conversations")) return { rows: [{ active_ai_agent_id: null, active_intent: null }] };
      if (sql.includes("id<>$3")) return { rows: [] };
      return { rows: [{ id: "msg-1", body: "quero investir" }] };
    }),
  } as unknown as pg.Pool;
}

function turno(politica: string, agenteDaIntencao: "comercial" | "academico", comercialNoAr: string | null = "comercial") {
  const d = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    agenteDaCampanha: vi.fn(async () => null),
    loadActiveRouter: vi.fn(async () => roteador(agenteDaIntencao)),
    loadPublishedAgentConfig: vi.fn(async () => null),
    loadPublishedAgentConfigById: vi.fn(async (_db: unknown, _t: string, id: string) =>
      id === "academico" ? config("academico", "academico") : id === "comercial" ? config("comercial", "comercial") : null,
    ),
    classifyIntent: vi.fn(async () => ({ intentName: "investir", confidence: 0.9 })),
    politicaDoContato: vi.fn(async () => politica),
    agenteAcademicoDoNumero: vi.fn(async () => "academico"),
    agenteComercialDoNumero: vi.fn(async () => comercialNoAr),
  };
  return resolveConversationTurn(
    dbFalso(),
    {} as never,
    { tenantId: "org", leadId: "contato", jobId: "job", conversationId: "conv", channelSessionId: "sessao", inbound: true },
    d as never,
  );
}

describe("o destino da intenção segue a etapa do contato", () => {
  it("controle: etapa comercial + intenção do agente comercial → o destino vale", async () => {
    const r = await turno("comercial", "comercial");
    expect(r.config?.agentId).toBe("comercial");
    expect(r.destinationPipelineId).toBe("pipe-investimentos");
    expect(r.destinationStageId).toBe("stage-investimentos-1");
  });

  it.each(["humano", "terminal"])("etapa %s → o roteador não move o card", async (politica) => {
    const r = await turno(politica, "comercial");
    expect(r.destinationPipelineId ?? null).toBeNull();
    expect(r.destinationStageId ?? null).toBeNull();
  });

  it("etapa acadêmica → sem destino (o aluno não é levado ao funil comercial)", async () => {
    const r = await turno("academico", "comercial");
    expect(r.outcome).toBe("etapa_academica");
    expect(r.destinationPipelineId ?? null).toBeNull();
  });

  it("etapa comercial com a intenção do agente ACADÊMICO → o comercial assume, sem o destino dela", async () => {
    const r = await turno("comercial", "academico");
    expect(r.config?.agentId).toBe("comercial");
    expect(r.destinationPipelineId ?? null).toBeNull();
    expect(r.destinationStageId ?? null).toBeNull();
  });
});

// ─── 3: a transferência recusa etapa travada antes de clonar ────────────────

function adminFalso(exitLocked: boolean) {
  return {
    from(tabela: string) {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.maybeSingle = async () => {
        if (tabela === "crm_leads") return { data: { stage_id: "stage-origem" }, error: null };
        if (tabela === "crm_stages") return { data: { exit_locked: exitLocked, id: "stage-perda" }, error: null };
        return { data: null, error: null };
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: [{ id: "stage-destino", pipeline_id: "pipe-destino", position: 0, is_won: false, is_lost: false, is_archived: false }],
          error: null,
        }).then(resolve);
      return b;
    },
  } as unknown as SupabaseClient;
}

const ORIGEM = {
  id: "lead-origem",
  pipeline_id: "pipe-origem",
  status: "open",
  title: "Negócio",
  description: null,
  contact_id: "contato",
  value_cents: null,
  currency: "BRL",
  owner_user_id: null,
  owner_agent_id: null,
  expected_close_date: null,
  tags: [],
  source: null,
  custom_fields: {},
  source_metadata: {},
} as never;

const CTX = { organization_id: "org", actor: { type: "system", id: "teste" }, requestId: "req" } as never;

describe("transfereParaOFunil diante de etapa permanente", () => {
  beforeEach(() => {
    mocks.createLead.mockReset().mockResolvedValue({ id: "lead-clone" });
    mocks.encerra.mockReset().mockResolvedValue(undefined);
  });

  it("origem em etapa exit_locked → etapa_travada, sem clone e sem encerrar nada", async () => {
    const r = await transfereParaOFunil(adminFalso(true), "org", CTX, ORIGEM, "pipe-destino", null, "teste");
    expect(r).toEqual({ ok: false, error: "etapa_travada" });
    expect(mocks.createLead).not.toHaveBeenCalled();
    expect(mocks.encerra).not.toHaveBeenCalled();
  });

  it("controle: etapa livre → clona e encerra a origem, como no upstream", async () => {
    const r = await transfereParaOFunil(adminFalso(false), "org", CTX, ORIGEM, "pipe-destino", null, "teste");
    expect(r.ok).toBe(true);
    expect(mocks.createLead).toHaveBeenCalledTimes(1);
    expect(mocks.encerra).toHaveBeenCalledTimes(1);
  });
});
