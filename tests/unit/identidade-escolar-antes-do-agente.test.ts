/**
 * RESOLVEDOR DE IDENTIDADE ESCOLAR — antes da escolha do agente.
 *
 *   mensagem → identidade → política da etapa → agente → turno → envio
 *
 * Letras = casos da especificação do dono do produto (2026-09-30). A política por
 * etapa em si (quem pode atender cada etapa, trava de saída) está provada contra
 * Postgres real em `tests/invariants/politica-de-atendimento-por-etapa.test.ts`;
 * aqui fica o que é deste PR: a DECISÃO de identidade, QUANDO ela é perguntada, o
 * efeito dela na escolha do agente e a releitura do escopo no instante do envio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  limparCacheDeIdentidade,
  resolverIdentidadeDoContato,
  type IdentidadeDeps,
} from "@/lib/agent-engine/agent/identidade-do-contato";
import type { PublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";
import { resolveConversationTurn } from "@/lib/agent-engine/agent/resolve-turn-agent";
import { assertEscopoDaEtapaSupabase } from "@/lib/ai/agents/operation";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
import type { RespostaAlunoPorTelefone } from "@/lib/integracoes/sistema-escolar";
import { decidirIdentidadeEscolar } from "@/lib/leads/identidade-escolar";

const aluno = (nome: string, campo = "numero_contato") =>
  ({ id: 1, nome, matched_contact_field: campo }) as unknown as RespostaAlunoPorTelefone["alunos"][number];
const resposta = (o: Partial<RespostaAlunoPorTelefone>) =>
  ({ encontrado: true, match_type: "exact", alunos: [aluno("Ana Souza")], ...o }) as RespostaAlunoPorTelefone;

// ─── a decisão ───────────────────────────────────────────────────────────────

describe("decidirIdentidadeEscolar — só casamento exato com aluno vira relacionado", () => {
  it("B · exato com um aluno → relacionado_a_aluno", () => {
    expect(decidirIdentidadeEscolar(resposta({}))).toBe("relacionado_a_aluno");
  });
  it("D · exato com DOIS alunos → relacionado_a_aluno (o agente acadêmico desambigua depois)", () => {
    expect(decidirIdentidadeEscolar(resposta({ alunos: [aluno("Ana Souza"), aluno("Bruno Souza")] }))).toBe("relacionado_a_aluno");
  });
  it("H · casou por numero_contato2 → relacionado_a_aluno, e só isso (nenhum papel familiar)", () => {
    const r = decidirIdentidadeEscolar(resposta({ alunos: [aluno("Ana Souza", "numero_contato2")] }));
    expect(r).toBe("relacionado_a_aluno");
    expect(["relacionado_a_aluno", "desconhecido"]).toContain(r);
  });
  it("A · telefone sem cadastro → desconhecido", () => {
    expect(decidirIdentidadeEscolar(resposta({ encontrado: false, alunos: [] }))).toBe("desconhecido");
  });
  it("E · API antiga, sem match_type → desconhecido", () => {
    expect(decidirIdentidadeEscolar(resposta({ match_type: undefined }))).toBe("desconhecido");
  });
  it("G · colisão de outro DDD (casamento por sufixo) → desconhecido", () => {
    expect(decidirIdentidadeEscolar(resposta({ match_type: "suffix" as never }))).toBe("desconhecido");
  });
  it("F · consulta falhou (timeout, erro, payload inválido) → desconhecido", () => {
    expect(decidirIdentidadeEscolar(null)).toBe("desconhecido");
  });
  it("exato mas sem aluno na lista → desconhecido", () => {
    expect(decidirIdentidadeEscolar(resposta({ alunos: [] }))).toBe("desconhecido");
  });
});

// ─── quando pergunta ─────────────────────────────────────────────────────────

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const db = {} as pg.Pool;
function deps(o: Partial<IdentidadeDeps> & { resp?: RespostaAlunoPorTelefone | Error } = {}) {
  const buscar = vi.fn(async () => {
    if (o.resp instanceof Error) throw o.resp;
    return o.resp ?? resposta({});
  });
  const mover = vi.fn(async () => ({ moveu: true, motivo: "movido" as const, leadId: "lead-1" }));
  return {
    buscar,
    mover,
    d: {
      politica: async () => "comercial",
      temEtapaAcademica: async () => true,
      telefone: async () => "+5561999998888",
      carregarConfig: async () => ({ baseUrl: "https://escola.example", apiKey: "k" }) as never,
      agora: () => 1_000,
      ...o,
      buscar,
      mover,
    } as IdentidadeDeps,
  };
}
const resolver = (d: IdentidadeDeps) => resolverIdentidadeDoContato(db, { tenantId: "org", contactId: "contato" }, log, d);

beforeEach(() => limparCacheDeIdentidade());

describe("resolverIdentidadeDoContato — quando pergunta e o que faz", () => {
  it("B · exato → consulta e MOVE o card para a etapa acadêmica", async () => {
    const { d, buscar, mover } = deps();
    const r = await resolver(d);
    expect(buscar).toHaveBeenCalledOnce();
    expect(mover).toHaveBeenCalledWith({ organizationId: "org", contactId: "contato" });
    expect(r).toMatchObject({ consultou: true, identidade: "relacionado_a_aluno" });
  });

  it("A/E/G · não exato → não move, e o desconhecido fica em cache (sem nova chamada na rajada)", async () => {
    const { d, buscar, mover } = deps({ resp: resposta({ match_type: undefined }) });
    await resolver(d);
    await resolver(d);
    expect(buscar).toHaveBeenCalledOnce();
    expect(mover).not.toHaveBeenCalled();
  });

  it("o cache do desconhecido vence em 10 minutos", async () => {
    const { d, buscar } = deps({ resp: resposta({ encontrado: false, alunos: [] }) });
    await resolver(d);
    await resolver({ ...d, agora: () => 1_000 + 10 * 60_000 + 1 });
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("F · timeout → desconhecido, não move, e NÃO entra no cache (a próxima mensagem tenta de novo)", async () => {
    const { d, buscar, mover } = deps({ resp: new Error("The operation was aborted") });
    const r = await resolver(d);
    await resolver(d);
    expect(r).toMatchObject({ identidade: "desconhecido", falhou: true });
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(mover).not.toHaveBeenCalled();
  });

  it("I · contato já fora da etapa comercial (ex.: Alunos) → nem consulta", async () => {
    const { d, buscar, mover } = deps({ politica: async () => "academico" });
    expect(await resolver(d)).toEqual({ consultou: false, motivo: "etapa_nao_comercial" });
    expect(buscar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
  });

  it.each(["terminal", "humano"])("contato em etapa %s → nem consulta (não se reclassifica por telefone)", async (politica) => {
    const { d, buscar } = deps({ politica: async () => politica });
    await resolver(d);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("funil sem etapa acadêmica → nem consulta (custo zero para quem não usa a regra)", async () => {
    const { d, buscar } = deps({ temEtapaAcademica: async () => false });
    expect(await resolver(d)).toEqual({ consultou: false, motivo: "sem_etapa_academica" });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("organização sem integração, ou contato sem telefone → nem consulta", async () => {
    const semConfig = deps({ carregarConfig: async () => null });
    expect(await resolver(semConfig.d)).toEqual({ consultou: false, motivo: "sem_integracao" });
    const semTelefone = deps({ telefone: async () => null });
    expect(await resolver(semTelefone.d)).toEqual({ consultou: false, motivo: "sem_telefone" });
    expect(semConfig.buscar).not.toHaveBeenCalled();
    expect(semTelefone.buscar).not.toHaveBeenCalled();
  });

  it("erro inesperado (banco) → desconhecido, sem derrubar o turno", async () => {
    const { d, mover } = deps({ politica: async () => { throw new Error("banco fora"); } });
    expect(await resolver(d)).toMatchObject({ identidade: "desconhecido", falhou: true });
    expect(mover).not.toHaveBeenCalled();
  });
});

// ─── identidade ANTES do agente ──────────────────────────────────────────────

const cfg = (agentId: string, serviceScope: "comercial" | "academico") =>
  ({ agentId, versionId: `v-${agentId}`, serviceScope, canUpdateLeadState: serviceScope === "comercial" }) as PublishedAgentConfig;
const COMERCIAL = cfg("comercial", "comercial");
const ACADEMICO = cfg("academico", "academico");

function turno(body: string, identidadeRelacionada: boolean) {
  let politica = "comercial";
  const dbTurno = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from conversations")) return { rows: [{ active_ai_agent_id: null, active_intent: null }] };
      if (sql.includes("id<>$3")) return { rows: [] };
      return { rows: [{ id: "msg-1", body }] };
    }),
  } as unknown as pg.Pool;
  const resolverIdentidade = vi.fn(async () => {
    if (identidadeRelacionada) politica = "academico"; // o card foi para Alunos e responsáveis
  });
  const r = resolveConversationTurn(
    dbTurno,
    {} as never,
    { tenantId: "org", leadId: "contato", jobId: "job", conversationId: "conv", channelSessionId: "sessao", inbound: true },
    {
      log,
      agenteDaCampanha: vi.fn(async () => null),
      loadActiveRouter: vi.fn(async () => null),
      loadPublishedAgentConfig: vi.fn(async () => COMERCIAL),
      loadPublishedAgentConfigById: vi.fn(async (_d: unknown, _t: string, id: string) => (id === "academico" ? ACADEMICO : COMERCIAL)),
      classifyIntent: vi.fn(),
      resolverIdentidade,
      politicaDoContato: vi.fn(async () => politica),
      agenteAcademicoDoNumero: vi.fn(async () => "academico"),
    } as never,
  );
  return { r, resolverIdentidade };
}

describe("B/C · a identidade decide a etapa ANTES de o agente ser escolhido", () => {
  it("B · aluno com pergunta acadêmica → agente acadêmico", async () => {
    const { r, resolverIdentidade } = turno("qual minha nota?", true);
    expect((await r).config?.agentId).toBe("academico");
    expect(resolverIdentidade).toHaveBeenCalledOnce();
  });

  it("C · aluno com pergunta COMERCIAL → continua acadêmico (o comercial não é elegível)", async () => {
    const { r } = turno("quanto custa o curso de Java?", true);
    expect((await r).config?.agentId).toBe("academico");
  });

  it("A · telefone desconhecido com pergunta comercial → fluxo comercial", async () => {
    const { r } = turno("quanto custa o curso de Excel?", false);
    expect((await r).config?.agentId).toBe("comercial");
  });
});

// ─── J/M · a última defesa: o escopo relido no envio ─────────────────────────

function supabaseDoEnvio(politica: string, escopo: string) {
  return {
    rpc: vi.fn(async () => ({ data: politica, error: null })),
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: { service_scope: escopo }, error: null });
      return q;
    },
  } as unknown as SupabaseClient;
}
const op = { organizationId: "org", versionId: "v" };

describe("J/M · escopo relido no beforeSend — o card pode ter mudado durante a geração", () => {
  it.each([
    ["academico", "comercial"],
    ["comercial", "academico"],
    ["terminal", "comercial"],
    ["humano", "comercial"],
    ["humano", "academico"],
  ])("etapa %s + agente %s → envio descartado", async (politica, escopo) => {
    await expect(assertEscopoDaEtapaSupabase(supabaseDoEnvio(politica, escopo), op, "contato")).rejects.toBeInstanceOf(
      StaleServiceBoundaryError,
    );
  });

  it.each([
    ["comercial", "comercial"],
    ["academico", "academico"],
  ])("controle: etapa %s + agente %s → envia", async (politica, escopo) => {
    await expect(assertEscopoDaEtapaSupabase(supabaseDoEnvio(politica, escopo), op, "contato")).resolves.toBeUndefined();
  });

  it("o handler relê o escopo no beforeSend, junto da operação do agente", async () => {
    const { readFileSync } = await import("node:fs");
    const handler = readFileSync("app/api/v1/messages/_handler.ts", "utf8");
    const bloco = handler.slice(handler.indexOf("const checkBoundary = async () => {"));
    expect(bloco.slice(0, 1200)).toMatch(/assertEscopoDaEtapaSupabase\(supabase, ctx\.agentOperation, c\.contact_id\)/);
  });
});

// ─── o movimento do card ─────────────────────────────────────────────────────

describe("moverContatoParaEtapaAcademica — a etapa é achada pela POLÍTICA, não pelo nome", () => {
  function supabaseDoMovimento(o: { leads: unknown[]; academica: unknown; atualizadas?: unknown[] }) {
    const updates: unknown[] = [];
    const filtros: Array<[string, unknown]> = [];
    const client = {
      updates,
      filtros,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from(tabela: string) {
        const q: Record<string, unknown> = {};
        let modo = "select";
        let porId = false;
        q.select = () => q;
        q.order = () => q;
        q.limit = () => q;
        q.insert = () => q;
        q.update = (patch: unknown) => { modo = "update"; updates.push(patch); return q; };
        q.eq = (col: string, val: unknown) => { filtros.push([col, val]); if (col === "id") porId = true; return q; };
        q.maybeSingle = async () =>
          tabela === "crm_stages" ? { data: porId ? { name: "Novo" } : o.academica, error: null } : { data: null, error: null };
        q.single = q.maybeSingle;
        q.then = (res: (v: unknown) => unknown) => {
          if (modo === "update") return Promise.resolve({ data: o.atualizadas ?? [{ id: "lead-1" }], error: null }).then(res);
          if (tabela === "crm_leads") return Promise.resolve({ data: o.leads, error: null }).then(res);
          return Promise.resolve({ data: [], error: null }).then(res);
        };
        return q;
      },
    };
    return client as unknown as SupabaseClient & { updates: unknown[]; filtros: Array<[string, unknown]> };
  }
  const LEAD = { id: "lead-1", pipeline_id: "pipe", stage_id: "s-novo", status: "open", created_at: "2026-09-30" };

  it("lead aberto em Novo → vai para a etapa de política academico", async () => {
    const { moverContatoParaEtapaAcademica } = await import("@/lib/leads/identidade-escolar");
    const sb = supabaseDoMovimento({ leads: [LEAD], academica: { id: "s-alunos", name: "Alunos e responsáveis" } });
    const r = await moverContatoParaEtapaAcademica(sb, { organizationId: "org", contactId: "contato" });
    expect(r).toMatchObject({ moveu: true, motivo: "movido" });
    expect(sb.updates).toContainEqual({ stage_id: "s-alunos" });
    expect(sb.filtros).toContainEqual(["service_policy", "academico"]);
  });

  it("já está lá → não escreve", async () => {
    const { moverContatoParaEtapaAcademica } = await import("@/lib/leads/identidade-escolar");
    const sb = supabaseDoMovimento({ leads: [{ ...LEAD, stage_id: "s-alunos" }], academica: { id: "s-alunos", name: "Alunos" } });
    expect(await moverContatoParaEtapaAcademica(sb, { organizationId: "org", contactId: "contato" })).toMatchObject({ motivo: "ja_esta_la" });
    expect(sb.updates).toHaveLength(0);
  });

  it("funil sem etapa acadêmica → não escreve", async () => {
    const { moverContatoParaEtapaAcademica } = await import("@/lib/leads/identidade-escolar");
    const sb = supabaseDoMovimento({ leads: [LEAD], academica: null });
    expect(await moverContatoParaEtapaAcademica(sb, { organizationId: "org", contactId: "contato" })).toMatchObject({ motivo: "sem_etapa_academica" });
    expect(sb.updates).toHaveLength(0);
  });

  it("humano moveu o card no meio-tempo (0 linhas) → conflito_humano, a decisão dele vence", async () => {
    const { moverContatoParaEtapaAcademica } = await import("@/lib/leads/identidade-escolar");
    const sb = supabaseDoMovimento({ leads: [LEAD], academica: { id: "s-alunos", name: "Alunos" }, atualizadas: [] });
    expect(await moverContatoParaEtapaAcademica(sb, { organizationId: "org", contactId: "contato" })).toMatchObject({ motivo: "conflito_humano" });
  });

  it("sem lead aberto → nada a mover", async () => {
    const { moverContatoParaEtapaAcademica } = await import("@/lib/leads/identidade-escolar");
    const sb = supabaseDoMovimento({ leads: [], academica: { id: "s-alunos", name: "Alunos" } });
    expect(await moverContatoParaEtapaAcademica(sb, { organizationId: "org", contactId: "contato" })).toMatchObject({ motivo: "sem_lead_aberto" });
  });
});
