/**
 * A POLÍTICA DE ATENDIMENTO POR ETAPA (migration 0404) no lado TypeScript.
 *
 * A decisão "quem pode atender" e a trava de saída são do BANCO — provadas em
 * `tests/invariants/politica-de-atendimento-por-etapa.test.ts` contra Postgres
 * real. Aqui ficam as peças de código que conversam com essa regra:
 *
 *   - `update_lead_state`: agente acadêmico (ou sem `can_update_lead_state`)
 *     não move o funil — N, J;
 *   - o roteamento: contato em etapa acadêmica vai ao agente acadêmico, mesmo
 *     quando o classificador de texto aponta o comercial — G, H, M e a intenção
 *     comercial no meio da conversa;
 *   - os movimentos automáticos (espelho da IA, handoff) diante de etapa
 *     travada: respondem `etapa_travada`, sem escrever e sem abrir incidente;
 *   - a recusa do banco (PT423) reconhecida em qualquer transporte.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import type { PublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";
import { verificarPermissaoDeMoverFunil } from "@/lib/agent-engine/agent/lead-state";
import { resolveConversationTurn } from "@/lib/agent-engine/agent/resolve-turn-agent";
import { avisoDoEspelhoRecusado, MIRROR_WARN_ONLY } from "@/lib/agent-engine/edge/crm/move-lead-stage";
import { sincronizaEstagioDoAgente } from "@/lib/leads/agent-stage-sync";
import { moverLeadParaEtapaDeHandoff } from "@/lib/leads/handoff-stage-move";
import { ehRecusaDeEtapaTravada, SQLSTATE_ETAPA_TRAVADA } from "@/lib/leads/politica-de-etapa";

// ─── update_lead_state ───────────────────────────────────────────────────────

describe("N/J — quem pode mover o funil com update_lead_state", () => {
  it("agente ACADÊMICO nunca move — nem com can_update_lead_state=true (o escopo vence)", () => {
    const r = verificarPermissaoDeMoverFunil({ serviceScope: "academico", canUpdateLeadState: true });
    expect(r).toMatchObject({ ok: false, error: { code: "funil_nao_autorizado" } });
  });

  it("agente comercial SEM a capability não move", () => {
    const r = verificarPermissaoDeMoverFunil({ serviceScope: "comercial", canUpdateLeadState: false });
    expect(r.ok).toBe(false);
  });

  it("controle: agente comercial COM a capability move (a trava da etapa ainda vale no banco)", () => {
    expect(verificarPermissaoDeMoverFunil({ serviceScope: "comercial", canUpdateLeadState: true })).toEqual({ ok: true });
  });

  it("sem agente publicado: comportamento de antes (won/lost seguem barrados por verificarAutorizacaoTerminal)", () => {
    expect(verificarPermissaoDeMoverFunil(null)).toEqual({ ok: true });
  });
});

// ─── roteamento ──────────────────────────────────────────────────────────────

function config(agentId: string, serviceScope: "comercial" | "academico"): PublishedAgentConfig {
  return { agentId, versionId: `v-${agentId}`, serviceScope, canUpdateLeadState: serviceScope === "comercial" } as PublishedAgentConfig;
}
const COMERCIAL = config("comercial", "comercial");
const ACADEMICO = config("academico", "academico");

/** Banco falso do `resolveConversationTurn`: sem roteador, conversa sem sticky, uma inbound. */
function dbFalso(body: string) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from conversations")) return { rows: [{ active_ai_agent_id: null, active_intent: null }] };
      if (sql.includes("id<>$3")) return { rows: [] };
      return { rows: [{ id: "msg-1", body }] };
    }),
  } as unknown as pg.Pool;
}
function deps(
  politica: string,
  agenteDaSessao: PublishedAgentConfig | null,
  academicoNoAr: string | null,
  comercialNoAr: string | null = null,
) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    log,
    agenteDaCampanha: vi.fn(async () => null),
    loadActiveRouter: vi.fn(async () => null),
    loadPublishedAgentConfig: vi.fn(async () => agenteDaSessao),
    loadPublishedAgentConfigById: vi.fn(async (_db: unknown, _t: string, id: string) =>
      id === "academico" ? ACADEMICO : id === "comercial" ? COMERCIAL : null,
    ),
    classifyIntent: vi.fn(),
    politicaDoContato: vi.fn(async () => politica),
    agenteAcademicoDoNumero: vi.fn(async () => academicoNoAr),
    agenteComercialDoNumero: vi.fn(async () => comercialNoAr),
  };
}
const turno = (body: string, d: ReturnType<typeof deps>) =>
  resolveConversationTurn(
    dbFalso(body),
    {} as never,
    { tenantId: "org", leadId: "contato", jobId: "job", conversationId: "conv", channelSessionId: "sessao", inbound: true },
    d as never,
  );

describe("G/H/M — a etapa do contato decide o agente", () => {
  it("H · contato em Alunos e responsáveis → agente acadêmico, mesmo com o comercial publicado na sessão", async () => {
    const r = await turno("qual minha nota?", deps("academico", COMERCIAL, "academico"));
    expect(r.config?.agentId).toBe("academico");
    expect(r.outcome).toBe("etapa_academica");
  });

  it("G/M · intenção COMERCIAL no meio da conversa não tira o contato do acadêmico", async () => {
    const r = await turno("quanto custa o curso de Java?", deps("academico", COMERCIAL, "academico"));
    expect(r.config?.agentId).toBe("academico");
  });

  it("etapa acadêmica sem agente acadêmico no ar → ninguém (o comercial não substitui)", async () => {
    const r = await turno("qual minha nota?", deps("academico", COMERCIAL, null));
    expect(r.config).toBeNull();
  });

  it("A/B/C · etapa comercial → o agente comercial da sessão, como antes", async () => {
    const r = await turno("quanto custa?", deps("comercial", COMERCIAL, "academico"));
    expect(r.config?.agentId).toBe("comercial");
  });

  it("etapa comercial com o ACADÊMICO resolvido → não é ele quem atende", async () => {
    const r = await turno("quanto custa?", deps("comercial", ACADEMICO, "academico"));
    expect(r.config).toBeNull();
  });

  it("etapa comercial com o ACADÊMICO acima na prioridade → o comercial do número atende (não o silêncio)", async () => {
    const r = await turno("quanto custa?", deps("comercial", ACADEMICO, "academico", "comercial"));
    expect(r.config?.agentId).toBe("comercial");
  });
});

// ─── movimentos automáticos diante da trava ─────────────────────────────────

/** Supabase falso mínimo: leads do contato, etapas do funil, e registro de UPDATE. */
function supabaseFalso(o: { leads: unknown[]; etapas: unknown[]; origem?: unknown; updateError?: unknown }) {
  const updates: unknown[] = [];
  const client = {
    updates,
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from(tabela: string) {
      const b: Record<string, unknown> = {};
      let modo: "select" | "update" = "select";
      let porId = false;
      b.select = () => b;
      b.update = (patch: unknown) => {
        modo = "update";
        updates.push({ tabela, patch });
        return b;
      };
      b.eq = (coluna: string) => {
        if (coluna === "id") porId = true;
        return b;
      };
      b.maybeSingle = async () => {
        if (tabela === "crm_leads") return { data: o.leads[0] ?? null, error: null };
        if (tabela === "crm_stages") return { data: porId ? (o.origem ?? null) : { id: "s-equipe", name: "Equipe" }, error: null };
        return { data: null, error: null };
      };
      b.then = (resolve: (v: unknown) => unknown) => {
        if (modo === "update") return Promise.resolve({ data: o.updateError ? null : [{ id: "lead-1" }], error: o.updateError ?? null }).then(resolve);
        if (tabela === "crm_leads") return Promise.resolve({ data: o.leads, error: null }).then(resolve);
        if (tabela === "crm_stages") return Promise.resolve({ data: o.etapas, error: null }).then(resolve);
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return b;
    },
  };
  return client as unknown as SupabaseClient & { updates: unknown[] };
}

const LEAD_EM_ALUNOS = {
  id: "lead-1", organization_id: "org", pipeline_id: "pipe", stage_id: "s-alunos", status: "open",
  contact_id: "contato", created_at: "2026-09-01T00:00:00Z", last_activity_at: null,
};
const ETAPAS = [
  { id: "s-alunos", name: "Alunos e responsáveis", agent_stage_hint: null, is_archived: false, is_lost: false, exit_locked: true },
  { id: "s-interessado", name: "Interessado", agent_stage_hint: "qualified", is_archived: false, is_lost: false, exit_locked: false },
];

describe("J/L · movimentos automáticos não tiram o card de etapa travada", () => {
  it("espelho da IA (update_lead_state → CRM): etapa_travada, sem UPDATE", async () => {
    const sb = supabaseFalso({ leads: [LEAD_EM_ALUNOS], etapas: ETAPAS });
    const r = await sincronizaEstagioDoAgente(sb, { organizationId: "org", contactId: "contato", passo: "qualified" });
    expect(r).toMatchObject({ moveu: false, motivo: "etapa_travada" });
    expect(sb.updates).toHaveLength(0);
  });

  it("handoff de um aluno: a pessoa assume a conversa, o card NÃO vai para Equipe", async () => {
    const sb = supabaseFalso({ leads: [LEAD_EM_ALUNOS], etapas: ETAPAS, origem: { name: "Alunos e responsáveis", exit_locked: true } });
    const r = await moverLeadParaEtapaDeHandoff(sb, { organizationId: "org", leadId: "lead-1", reason: "requested_human" });
    expect(r).toEqual({ moveu: false, motivo: "etapa_travada" });
    expect(sb.updates).toHaveLength(0);
  });

  it("rede de segurança: se o banco recusar (PT423), o handoff responde etapa_travada, não falha de escrita", async () => {
    const sb = supabaseFalso({
      leads: [LEAD_EM_ALUNOS], etapas: ETAPAS, origem: { name: "Alunos e responsáveis", exit_locked: false },
      updateError: { code: SQLSTATE_ETAPA_TRAVADA, message: "etapa_travada" },
    });
    const r = await moverLeadParaEtapaDeHandoff(sb, { organizationId: "org", leadId: "lead-1", reason: "requested_human" });
    expect(r.motivo).toBe("etapa_travada");
  });

  it("o espelho trata etapa_travada como estado legítimo: nenhum item de incidente na Central", () => {
    expect(MIRROR_WARN_ONLY.has("etapa_travada")).toBe(true);
    expect(avisoDoEspelhoRecusado({ motivo: "etapa_travada", detalhe: "x", etapaDeDestino: "Interessado" })).toBeNull();
  });
});

describe("a recusa do banco é reconhecida em qualquer transporte", () => {
  it.each([
    [{ code: "PT423", message: "etapa_travada" }, true],
    [{ message: 'etapa_travada' }, true],
    [{ code: "23505", message: "duplicate key" }, false],
    [null, false],
  ])("%j → %s", (erro, esperado) => {
    expect(ehRecusaDeEtapaTravada(erro)).toBe(esperado);
  });
});
