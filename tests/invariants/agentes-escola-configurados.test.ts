/**
 * OS DOIS AGENTES DA ESCOLA, NO ARRANJO EM QUE SÃO CONFIGURADOS — contra Postgres real.
 *
 * `politica-de-atendimento-por-etapa.test.ts` prova a régua SQL com agentes de
 * brinquedo. Este arquivo prova o ARRANJO de produção:
 *   - as versões saem dos perfis oficiais (`PERFIL_*_ESCOLA`, PR #6) pelo mesmo
 *     `versionCreateSchema` que a tela e a operação assistida usam;
 *   - os dois no MESMO número, SEM roteador; comercial com prioridade 10,
 *     acadêmico com 0 (o desempate de `loadPublishedAgentConfig`);
 *   - o funil "Contatos" com as etapas, dicas e políticas de produção, incluindo
 *     a etapa arquivada "Quer entrar".
 * E passa pelo código real de seleção (`resolveConversationTurn`), de montagem da
 * config (`loadPublishedAgentConfigById`), de tools (`ferramentasOcultasPeloEscopo`)
 * e do executor (`verificarPermissaoDeMoverFunil`) — nada é dublê, só a
 * integração do sistema escolar (que é HTTP, e tem prova própria).
 *
 * Letras = casos da especificação do dono (2026-10-01).
 */
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadPublishedAgentConfigById, matchesHandoffKeyword } from "@/lib/agent-engine/agent/agent-config";
import { ferramentasOcultasPeloEscopo } from "@/lib/agent-engine/agent/ferramentas-por-escopo";
import { detectHumanHandoffRequest, isLeadInHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { verificarPermissaoDeMoverFunil } from "@/lib/agent-engine/agent/lead-state";
import { resolveConversationTurn } from "@/lib/agent-engine/agent/resolve-turn-agent";
import type { LlmEdgeConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import {
  PALAVRAS_DE_PASSAGEM_ESCOLA,
  PERFIL_ACADEMICO_ESCOLA,
  PERFIL_COMERCIAL_ESCOLA,
  type PerfilDeAgente,
} from "@/lib/ai/agents/modelos-escola";
import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { buscarAlunoPorTelefone, selecionarAluno } from "@/lib/integracoes/sistema-escolar";
import { API_DOIS_ALUNOS } from "../fixtures/atendimento-ao-aluno";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 5,
});

const ORG = randomUUID();
const SESSION = randomUUID();
const PIPE = randomUUID();
const COMERCIAL = { agent: randomUUID(), version: randomUUID() };
const ACADEMICO = { agent: randomUUID(), version: randomUUID() };
const CONECTOU = new Date(Date.now() - 30 * 86_400_000).toISOString();

const E = {
  novo: randomUUID(),
  interessado: randomUUID(),
  querEntrar: randomUUID(),
  fechando: randomUUID(),
  desistiu: randomUUID(),
  desqualificado: randomUUID(),
  equipe: randomUUID(),
  alunos: randomUUID(),
};

const log = createLogger(new Writable({ write: (_c, _e, cb) => cb() }));
const LLM = {} as LlmEdgeConfig; // sem roteador o classificador nunca roda

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}
const depois = (s: number) => new Date(Date.now() + s * 1000).toISOString();

async function contatoNaEtapa(stageId: string, o: { status?: string; mensagem?: string } = {}) {
  const ct = randomUUID();
  await q("insert into contacts(id,organization_id,display_name,phone_number) values($1,$2,'Contato',$3)", [
    ct, ORG, `+55619${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
  ]);
  const lead = randomUUID();
  const status = o.status ?? "open";
  await q(
    `insert into crm_leads(id,organization_id,contact_id,pipeline_id,stage_id,title,status,closed_at,lost_reason)
     values($1,$2,$3,$4,$5,'Lead',$6,$7,$8)`,
    [lead, ORG, ct, PIPE, stageId, status, status === "open" ? null : new Date().toISOString(), status === "lost" ? "price" : null],
  );
  const conv = randomUUID();
  await q(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')",
    [conv, ORG, ct, SESSION],
  );
  const inbound = randomUUID();
  await q(
    `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at)
     values($1,$2,$3,$4,$5,'text','inbound','received','external_device',$6,$7)`,
    [inbound, ORG, conv, SESSION, ct, o.mensagem ?? "oi", depois(2)],
  );
  return { ct, lead, conv, inbound };
}

const pode = async (messageId: string, agentId: string | null) =>
  (await q<{ m: string }>("select public.fn_ia_pode_responder_mensagem($1,$2,$3) m", [ORG, messageId, agentId]))[0]!.m;

/** Quem o turno escolheria — o código real de seleção, sem dublê de banco. */
async function quemAtende(c: { ct: string; conv: string }) {
  const r = await resolveConversationTurn(
    pool,
    LLM,
    { tenantId: ORG, leadId: c.ct, jobId: randomUUID(), conversationId: c.conv, channelSessionId: SESSION, inbound: true },
    { log, resolverIdentidade: async () => undefined },
  );
  return r.config?.agentId ?? null;
}

async function mover(leadId: string, stageId: string): Promise<string | null> {
  try {
    await q("update crm_leads set stage_id=$2 where id=$1", [leadId, stageId]);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "erro";
  }
}

/** A versão como a operação assistida grava: perfil oficial + campos da organização. */
function versaoDoPerfil(perfil: PerfilDeAgente, materiais: string[]) {
  return versionCreateSchema.parse({
    ...perfil,
    system_prompt: perfil.system_prompt.replaceAll("{nome da escola}", "Escola"),
    provider: "openai",
    model: "gpt-5.6-terra",
    credential_id: null,
    channel_session_id: SESSION,
    pipeline_ids: [PIPE],
    knowledge_source_ids: materiais,
    followup: { enabled: false, flow_pointer_ids: [], send_window: null },
  });
}

beforeAll(async () => {
  await q("insert into organizations(id,display_name,legal_name,slug) values($1,'Escola','Escola',$2)", [ORG, `escola-${ORG}`]);
  await q(
    `insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted,status,first_connected_at)
     values($1,$2,$3,'\\x00'::bytea,'WORKING',$4)`,
    [SESSION, ORG, `escola-${SESSION}`, CONECTOU],
  );
  await q("insert into crm_pipelines(id,organization_id,name,slug) values($1,$2,'Contatos','contatos')", [PIPE, ORG]);
  // As etapas de produção (slug, dica, política, trava), na ordem da tela.
  const etapas: Array<[string, string, string, number, string | null, string, boolean, boolean, boolean]> = [
    [E.novo, "Novo", "novo_interessado", 1000, "new", "comercial", false, false, false],
    [E.interessado, "Interessado", "ja_respondi", 2000, "qualified", "comercial", false, false, false],
    [E.querEntrar, "Quer entrar", "quer_entrar", 2500, null, "comercial", false, false, true],
    [E.fechando, "Fechando condições", "fechando_condicoes", 2600, "negotiating", "comercial", false, false, false],
    [E.desistiu, "Desistiu", "desistiu", 2750, "lost", "terminal", true, false, false],
    [E.desqualificado, "Desqualificado", "tirando_duvidas", 3000, null, "terminal", false, false, false],
    [E.equipe, "Equipe", "chamar-humano", 4500, null, "humano", false, false, false],
    [E.alunos, "Alunos e responsáveis", "matriculado", 6000, null, "academico", false, true, false],
  ];
  for (const [id, name, slug, position, hint, politica, isLost, travada, arquivada] of etapas) {
    await q(
      `insert into crm_stages(id,organization_id,pipeline_id,name,slug,position,agent_stage_hint,service_policy,is_lost,exit_locked,is_archived)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, ORG, PIPE, name, slug, position, hint, politica, isLost, travada, arquivada],
    );
  }
  const material = randomUUID();
  await q(
    "insert into ai_knowledge_sources(id,organization_id,name,source_type,status,is_active) values($1,$2,'Playbook','documento','ready',true)",
    [material, ORG],
  );
  // Comercial primeiro (o existente), acadêmico depois — prioridades 10 e 0.
  for (const [a, nome, prioridade, perfil, materiais] of [
    [COMERCIAL, "Escola – Comercial", 10, PERFIL_COMERCIAL_ESCOLA, [material]],
    [ACADEMICO, "Escola – Alunos e responsáveis", 0, PERFIL_ACADEMICO_ESCOLA, []],
  ] as const) {
    await q(
      "insert into ai_agents(id,organization_id,name,system_prompt,kind,priority,created_at) values($1,$2,$3,'legado','mcp_agent',$4,now() - make_interval(mins => $5))",
      [a.agent, ORG, nome, prioridade, prioridade],
    );
    const v = versaoDoPerfil(perfil, [...materiais]);
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    await q(
      `insert into ai_agent_versions(id,organization_id,agent_id,version_number,status,published_at,${entries.map(([k]) => k).join(",")})
       values($1,$2,$3,1,'published',now(),${entries.map((_, i) => `$${i + 4}`).join(",")})`,
      [a.version, ORG, a.agent, ...entries.map(([k, x]) => (["followup", "trigger_config"].includes(k) ? JSON.stringify(x) : x))],
    );
    await q("update ai_agents set published_version_id=$2 where id=$1", [a.agent, a.version]);
  }
});
afterAll(async () => {
  await pool.end();
});
afterEach(() => vi.unstubAllGlobals());

describe("A–I · quem atende cada etapa (seleção real, mesmo número, sem roteador)", () => {
  it.each([
    ["A · Novo", "novo"],
    ["B · Interessado", "interessado"],
    ["C · Fechando condições", "fechando"],
  ] as const)("%s → o turno escolhe o comercial, e só ele é autorizado", async (_c, etapa) => {
    const c = await contatoNaEtapa(E[etapa]);
    expect(await quemAtende(c)).toBe(COMERCIAL.agent);
    expect(await pode(c.inbound, COMERCIAL.agent)).toBe("autorizado");
    expect(await pode(c.inbound, ACADEMICO.agent)).toBe("agente_fora_do_escopo_da_etapa");
  });

  it.each([
    ["D · Desistiu", "desistiu", "lost", "etapa_sem_ia"],
    ["E · Desqualificado", "desqualificado", "open", "etapa_sem_ia"],
    ["F · Equipe", "equipe", "open", "etapa_so_humano"],
  ] as const)("%s → nenhum agente de IA responde", async (_c, etapa, status, motivo) => {
    const c = await contatoNaEtapa(E[etapa], { status });
    expect(await pode(c.inbound, COMERCIAL.agent)).toBe(motivo);
    expect(await pode(c.inbound, ACADEMICO.agent)).toBe(motivo);
    expect(await pode(c.inbound, null)).toBe(motivo);
  });

  it("G · Alunos e responsáveis → o turno escolhe o acadêmico (apesar da prioridade do comercial)", async () => {
    const c = await contatoNaEtapa(E.alunos);
    expect(await quemAtende(c)).toBe(ACADEMICO.agent);
    expect(await pode(c.inbound, ACADEMICO.agent)).toBe("autorizado");
  });

  it("H · comercial em Alunos → recusado pela régua", async () => {
    const c = await contatoNaEtapa(E.alunos);
    expect(await pode(c.inbound, COMERCIAL.agent)).toBe("agente_fora_do_escopo_da_etapa");
  });

  it("prioridade invertida (acadêmico acima) não silencia a etapa comercial", async () => {
    await q("update ai_agents set priority=20 where id=$1", [ACADEMICO.agent]);
    try {
      const novo = await contatoNaEtapa(E.novo);
      expect(await quemAtende(novo)).toBe(COMERCIAL.agent);
      const aluno = await contatoNaEtapa(E.alunos);
      expect(await quemAtende(aluno)).toBe(ACADEMICO.agent);
    } finally {
      await q("update ai_agents set priority=0 where id=$1", [ACADEMICO.agent]);
    }
  });

  it("I · acadêmico em Novo → recusado, e nem a aderência da conversa o traz de volta", async () => {
    const c = await contatoNaEtapa(E.novo);
    await q("update conversations set active_ai_agent_id=$2 where id=$1", [c.conv, ACADEMICO.agent]);
    expect(await pode(c.inbound, ACADEMICO.agent)).toBe("agente_fora_do_escopo_da_etapa");
    expect(await quemAtende(c)).toBe(COMERCIAL.agent);
  });
});

describe("a prioridade nunca vence o escopo: matriz de prioridade × quem está no ar", () => {
  /** Monta o cenário, roda, e devolve tudo ao arranjo de produção (10/0, os dois no ar). */
  async function comArranjo(
    o: { comercial: number; academico: number; noAr: Array<"comercial" | "academico"> },
    corpo: () => Promise<void>,
  ) {
    await q("update ai_agents set priority=$2 where id=$1", [COMERCIAL.agent, o.comercial]);
    await q("update ai_agents set priority=$2 where id=$1", [ACADEMICO.agent, o.academico]);
    for (const [nome, a] of [["comercial", COMERCIAL], ["academico", ACADEMICO]] as const) {
      await q("update ai_agents set published_version_id=$2 where id=$1", [a.agent, o.noAr.includes(nome) ? a.version : null]);
    }
    try {
      await corpo();
    } finally {
      await q("update ai_agents set priority=10, published_version_id=$2 where id=$1", [COMERCIAL.agent, COMERCIAL.version]);
      await q("update ai_agents set priority=0, published_version_id=$2 where id=$1", [ACADEMICO.agent, ACADEMICO.version]);
    }
  }
  const comerciais = ["novo", "interessado", "fechando"] as const;

  it.each([
    ["comercial 10 / acadêmico 0", 10, 0],
    ["comercial 0 / acadêmico 10", 0, 10],
    ["prioridades iguais", 5, 5],
  ] as const)("%s → etapa comercial = comercial; Alunos = acadêmico", async (_c, pc, pa) => {
    await comArranjo({ comercial: pc, academico: pa, noAr: ["comercial", "academico"] }, async () => {
      for (const etapa of comerciais) {
        const c = await contatoNaEtapa(E[etapa]);
        expect(await quemAtende(c), `${etapa}`).toBe(COMERCIAL.agent);
        expect(await pode(c.inbound, null)).toBe("autorizado");
      }
      const aluno = await contatoNaEtapa(E.alunos);
      expect(await quemAtende(aluno)).toBe(ACADEMICO.agent);
      expect(await pode(aluno.inbound, ACADEMICO.agent)).toBe("autorizado");
    });
  });

  it("só o comercial no ar → etapa comercial atende; Alunos fica sem IA (o comercial não substitui)", async () => {
    await comArranjo({ comercial: 0, academico: 10, noAr: ["comercial"] }, async () => {
      const novo = await contatoNaEtapa(E.novo);
      expect(await quemAtende(novo)).toBe(COMERCIAL.agent);
      const aluno = await contatoNaEtapa(E.alunos);
      expect(await quemAtende(aluno)).toBeNull();
      expect(await pode(aluno.inbound, null)).toBe("nenhum_agente_no_ar");
      expect(await pode(aluno.inbound, COMERCIAL.agent)).toBe("agente_fora_do_escopo_da_etapa");
    });
  });

  it("só o acadêmico no ar (e acima) → Alunos atende; etapa comercial fica sem IA (o acadêmico não vende)", async () => {
    await comArranjo({ comercial: 0, academico: 10, noAr: ["academico"] }, async () => {
      const aluno = await contatoNaEtapa(E.alunos);
      expect(await quemAtende(aluno)).toBe(ACADEMICO.agent);
      for (const etapa of comerciais) {
        const c = await contatoNaEtapa(E[etapa]);
        expect(await quemAtende(c), `${etapa}`).toBeNull();
        expect(await pode(c.inbound, ACADEMICO.agent)).toBe("agente_fora_do_escopo_da_etapa");
      }
    });
  });

  it("nenhum no ar → ninguém, em etapa comercial e em Alunos", async () => {
    await comArranjo({ comercial: 10, academico: 0, noAr: [] }, async () => {
      for (const etapa of ["novo", "alunos"] as const) {
        const c = await contatoNaEtapa(E[etapa]);
        expect(await quemAtende(c), etapa).toBeNull();
        expect(await pode(c.inbound, null), etapa).toBe("nenhum_agente_no_ar");
      }
    });
  });

  it.each([
    ["Equipe (humano)", "equipe", "open", "etapa_so_humano"],
    ["Desistiu (terminal)", "desistiu", "lost", "etapa_sem_ia"],
    ["Desqualificado (terminal)", "desqualificado", "open", "etapa_sem_ia"],
  ] as const)("%s → nenhuma IA, com qualquer prioridade", async (_c, etapa, status, motivo) => {
    for (const [pc, pa] of [[10, 0], [0, 10], [5, 5]] as const) {
      await comArranjo({ comercial: pc, academico: pa, noAr: ["comercial", "academico"] }, async () => {
        const c = await contatoNaEtapa(E[etapa], { status });
        // Quem quer que o seletor devolva, a régua do turno recusa todos.
        const escolhido = await quemAtende(c);
        expect(await pode(c.inbound, escolhido), `${pc}/${pa}`).toBe(motivo);
        expect(await pode(c.inbound, COMERCIAL.agent)).toBe(motivo);
        expect(await pode(c.inbound, ACADEMICO.agent)).toBe(motivo);
        expect(await pode(c.inbound, null)).toBe(motivo);
      });
    }
  });
});

describe("J · ferramentas e executor, sobre a config montada do banco", () => {
  it("acadêmico: update_lead_state e schedule_followup fora do turno; executor recusa", async () => {
    const cfg = await loadPublishedAgentConfigById(pool, ORG, ACADEMICO.agent);
    expect(cfg?.serviceScope).toBe("academico");
    expect(cfg?.canUpdateLeadState).toBe(false);
    expect(cfg?.canMarkWon).toBe(false);
    expect(cfg?.canMarkLost).toBe(false);
    expect(cfg?.sistemaEscolarToolIds).toEqual(["consultar_aluno_sistema_escolar"]);
    expect(cfg?.toolIds).toEqual([]);
    expect(ferramentasOcultasPeloEscopo(cfg!)).toEqual(expect.arrayContaining(["update_lead_state", "schedule_followup"]));
    expect(verificarPermissaoDeMoverFunil(cfg!).ok).toBe(false);
    // Mesmo que a coluna dissesse o contrário, o escopo acadêmico vence.
    expect(verificarPermissaoDeMoverFunil({ serviceScope: "academico", canUpdateLeadState: true }).ok).toBe(false);
  });

  it("comercial: move o funil, perde mas nunca ganha, só o catálogo do sistema escolar", async () => {
    const cfg = await loadPublishedAgentConfigById(pool, ORG, COMERCIAL.agent);
    expect(cfg?.serviceScope).toBe("comercial");
    expect(cfg?.canUpdateLeadState).toBe(true);
    expect(cfg?.canMarkWon).toBe(false);
    expect(cfg?.canMarkLost).toBe(true);
    expect(cfg?.sistemaEscolarToolIds).toEqual(["consultar_catalogo_cursos"]);
    expect(ferramentasOcultasPeloEscopo(cfg!)).toEqual([]);
    expect(verificarPermissaoDeMoverFunil(cfg!).ok).toBe(true);
  });
});

describe("K/L/M · passagem para uma pessoa", () => {
  it.each(["quero falar com alguém", "a secretaria abre que horas?", "Preciso falar com a SECRETARIA"])(
    "K/L · «%s» passa nos dois agentes (palavras gravadas na versão)",
    async (frase) => {
      for (const a of [COMERCIAL, ACADEMICO]) {
        const cfg = await loadPublishedAgentConfigById(pool, ORG, a.agent);
        expect(cfg?.handoffKeywords).toEqual([...PALAVRAS_DE_PASSAGEM_ESCOLA]);
        expect(cfg?.handoffToolEnabled).toBe(true);
        const pede = detectHumanHandoffRequest(frase) || matchesHandoffKeyword(frase, cfg!.handoffKeywords);
        expect(pede, `${a.agent} · ${frase}`).toBe(true);
      }
    },
  );

  it("M · handoff do acadêmico: a conversa vai a humano, o card NÃO sai de Alunos", async () => {
    const c = await contatoNaEtapa(E.alunos, { mensagem: "quero falar com a coordenação" });
    expect(await mover(c.lead, E.equipe)).toBe("PT423");
    expect((await q<{ s: string }>("select stage_id s from crm_leads where id=$1", [c.lead]))[0]!.s).toBe(E.alunos);
    // A pessoa assume do mesmo jeito: silêncio da IA no contato.
    await q("update contacts set force_human=true where id=$1", [c.ct]);
    expect(await isLeadInHandoff(pool, ORG, c.ct)).toBe(true);
  });

  it("controle de M · no comercial o handoff leva o card para Equipe", async () => {
    const c = await contatoNaEtapa(E.interessado);
    expect(await mover(c.lead, E.equipe)).toBeNull();
  });
});

describe("N/O · identificação do aluno (a integração devolve o que o agente vê)", () => {
  it("N · dois alunos no número → só a quantidade; o nome completo seleciona um", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(API_DOIS_ALUNOS), { status: 200 })));
    const cfg = { baseUrl: "https://escola.invalid", apiKey: "x" };
    const ambiguo = selecionarAluno(await buscarAlunoPorTelefone(cfg, "5561999990000"));
    expect(ambiguo).toEqual({ status: "ambiguo", quantidade: 2 });
    const um = selecionarAluno(await buscarAlunoPorTelefone(cfg, "5561999990000"), "ana ficticia lima");
    expect(um.status).toBe("encontrado");
    expect(JSON.stringify(um)).not.toContain("Pedro");
  });

  it("O · nada no que o agente vê diz se o número é do aluno ou do responsável", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(API_DOIS_ALUNOS), { status: 200 })));
    const r = selecionarAluno(
      await buscarAlunoPorTelefone({ baseUrl: "https://escola.invalid", apiKey: "x" }, "5561999990000"),
      "ana ficticia lima",
    );
    const visto = JSON.stringify(r);
    for (const proibido of ["numero_contato", "matched_contact_field", "responsavel", "\"id\""]) {
      expect(visto).not.toContain(proibido);
    }
  });
});

describe("P/Q", () => {
  it("P · pessoa assumiu (silêncio sem fim) → a IA fica calada nos dois agentes", async () => {
    const c = await contatoNaEtapa(E.novo);
    await q("update conversations set bot_silenced_until='infinity' where id=$1", [c.conv]);
    expect(await isLeadInHandoff(pool, ORG, c.ct)).toBe(true);
    const a = await contatoNaEtapa(E.alunos);
    await q("update conversations set bot_silenced_until='infinity' where id=$1", [a.conv]);
    expect(await isLeadInHandoff(pool, ORG, a.ct)).toBe(true);
  });

  it("Q · aluno pergunta preço → continua no acadêmico, o card não sai de Alunos, e não vira passagem automática", async () => {
    const frase = "quanto custa o curso de Excel?";
    const c = await contatoNaEtapa(E.alunos, { mensagem: frase });
    expect(await quemAtende(c)).toBe(ACADEMICO.agent);
    expect(await mover(c.lead, E.fechando)).toBe("PT423");
    expect((await q<{ s: string }>("select stage_id s from crm_leads where id=$1", [c.lead]))[0]!.s).toBe(E.alunos);
    expect(detectHumanHandoffRequest(frase) || matchesHandoffKeyword(frase, [...PALAVRAS_DE_PASSAGEM_ESCOLA])).toBe(false);
  });
});
