/**
 * POLÍTICA DE ATENDIMENTO POR ETAPA (migration 0404), contra Postgres real com o
 * baseline que o self-hoster aplica.
 *
 * O funil é o da escola que motivou a migration, montado do zero aqui:
 *
 *   Novo · Interessado · Fechando condições   → comercial
 *   Desistiu (perda)                          → terminal
 *   Desqualificado                            → terminal
 *   Equipe (slug chamar-humano)               → humano
 *   Alunos e responsáveis (travada)           → acadêmico, e o card não sai
 *
 * SEM etapa de ganho: o funil existe assim (R), e entrar em "Alunos e
 * responsáveis" não fecha o lead como venda (S).
 *
 * A régua é a das funções que TODO chamador já consulta — drain, turno, worker de
 * sentimento (`fn_ia_pode_responder_mensagem`), varredura e envio de follow-up
 * (`fn_silencio_pode_reengajar`, `fn_followup_pode_enviar`) — e o gatilho da trava
 * de saída, que vale para QUALQUER escritor (tela, API, MCP, IA, automação,
 * handoff): todos terminam num UPDATE de `crm_leads`, e é ele que é recusado.
 *
 * Letras = casos da especificação do dono do produto (2026-09-30).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  fechando: randomUUID(),
  desistiu: randomUUID(),
  desqualificado: randomUUID(),
  equipe: randomUUID(),
  alunos: randomUUID(),
};

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}
const depois = (s: number) => new Date(Date.now() + s * 1000).toISOString();

async function contato(): Promise<string> {
  const id = randomUUID();
  await q("insert into contacts(id,organization_id,display_name,phone_number) values($1,$2,'Contato',$3)", [
    id, ORG, `+55619${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
  ]);
  return id;
}
async function lead(contactId: string, stageId: string, o: { status?: string } = {}): Promise<string> {
  const id = randomUUID();
  const status = o.status ?? "open";
  await q(
    `insert into crm_leads(id,organization_id,contact_id,pipeline_id,stage_id,title,status,closed_at,lost_reason)
     values($1,$2,$3,$4,$5,'Lead',$6,$7,$8)`,
    [id, ORG, contactId, PIPE, stageId, status, status === "open" ? null : new Date().toISOString(), status === "lost" ? "price" : null],
  );
  return id;
}
/** Conversa com o contato falando e a IA respondendo por último — o estado que o follow-up cobra. */
async function conversaAtendida(contactId: string): Promise<{ conv: string; inbound: string }> {
  const conv = randomUUID();
  await q(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')",
    [conv, ORG, contactId, SESSION],
  );
  const inbound = randomUUID();
  await q(
    `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at)
     values($1,$2,$3,$4,$5,'text','inbound','received','external_device','oi',$6)`,
    [inbound, ORG, conv, SESSION, contactId, depois(2)],
  );
  await q(
    `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at)
     values($1,$2,$3,$4,$5,'text','outbound','sent','ai','olá!',$6)`,
    [randomUUID(), ORG, conv, SESSION, contactId, depois(3)],
  );
  return { conv, inbound };
}
const pode = async (messageId: string, agentId: string | null) =>
  (await q<{ m: string }>("select public.fn_ia_pode_responder_mensagem($1,$2,$3) m", [ORG, messageId, agentId]))[0]!.m;
const silencio = async (conv: string) =>
  (await q<{ m: string }>("select public.fn_silencio_pode_reengajar($1,$2,true) m", [ORG, conv]))[0]!.m;
async function envioDeFollowup(contactId: string, conv: string, gatilho: "silence" | "manual"): Promise<string> {
  const [versao] = await q<{ id: string }>(
    "insert into followup_flow_versions(organization_id,graph) values($1,'{\"nodes\":[],\"edges\":[]}') returning id",
    [ORG],
  );
  const [ponteiro] = await q<{ id: string }>(
    `insert into followup_flow_pointers(organization_id,name,status,active_version_id,trigger_config)
     values($1,$2,'active',$3,$4) returning id`,
    [ORG, `fluxo-${randomUUID()}`, versao!.id, JSON.stringify({ kind: gatilho, params: {} })],
  );
  const [inscricao] = await q<{ id: string }>(
    `insert into followup_enrollments(organization_id,pointer_id,version_id,contact_id,conversation_id,current_node_id,status,started_at)
     values($1,$2,$3,$4,$5,'trigger','active',now() - interval '1 day') returning id`,
    [ORG, ponteiro!.id, versao!.id, contactId, conv],
  );
  return (await q<{ m: string }>("select public.fn_followup_pode_enviar($1,$2) m", [ORG, inscricao!.id]))[0]!.m;
}
/** Tenta mover o lead; devolve o SQLSTATE da recusa, ou null se passou. */
async function mover(leadId: string, stageId: string): Promise<string | null> {
  try {
    await q("update crm_leads set stage_id=$2 where id=$1", [leadId, stageId]);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "erro";
  }
}

beforeAll(async () => {
  await q("insert into organizations(id,display_name,legal_name,slug) values($1,'Escola','Escola',$2)", [ORG, `escola-${ORG}`]);
  await q(
    `insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted,status,first_connected_at)
     values($1,$2,$3,'\\x00'::bytea,'WORKING',$4)`,
    [SESSION, ORG, `escola-${SESSION}`, CONECTOU],
  );
  // R — funil SEM etapa de ganho.
  await q("insert into crm_pipelines(id,organization_id,name,slug) values($1,$2,'Contatos','contatos')", [PIPE, ORG]);
  const etapas: Array<[string, string, string, number, Record<string, unknown>]> = [
    [E.novo, "Novo", "novo", 1000, {}],
    [E.interessado, "Interessado", "interessado", 2000, {}],
    [E.fechando, "Fechando condições", "fechando", 3000, {}],
    [E.desistiu, "Desistiu", "desistiu", 4000, { is_lost: true, service_policy: "terminal" }],
    [E.desqualificado, "Desqualificado", "desqualificado", 5000, { service_policy: "terminal" }],
    [E.equipe, "Equipe", "chamar-humano", 6000, { service_policy: "humano" }],
    [E.alunos, "Alunos e responsáveis", "alunos", 7000, { service_policy: "academico", exit_locked: true }],
  ];
  for (const [id, name, slug, position, extra] of etapas) {
    await q(
      `insert into crm_stages(id,organization_id,pipeline_id,name,slug,position,is_lost,service_policy,exit_locked)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ORG, PIPE, name, slug, position, extra.is_lost ?? false, extra.service_policy ?? "comercial", extra.exit_locked ?? false],
    );
  }
  for (const [a, escopo] of [[COMERCIAL, "comercial"], [ACADEMICO, "academico"]] as const) {
    await q("insert into ai_agents(id,organization_id,name,system_prompt,kind) values($1,$2,$3,'prompt','mcp_agent')", [
      a.agent, ORG, `Agente ${escopo}`,
    ]);
    await q(
      `insert into ai_agent_versions(id,organization_id,agent_id,version_number,system_prompt,provider,model,channel_session_id,status,published_at,service_scope,can_update_lead_state)
       values($1,$2,$3,1,'prompt','openai','gpt-4o-mini',$4,'published',now(),$5,$6)`,
      [a.version, ORG, a.agent, SESSION, escopo, escopo === "comercial"],
    );
    // Publicar carimba a ativação (0403): as mensagens de teste são posteriores.
    await q("update ai_agents set published_version_id=$2 where id=$1", [a.agent, a.version]);
  }
});
afterAll(async () => {
  await pool.end();
});

describe("R/S — o funil existe sem etapa de ganho, e a etapa acadêmica não é venda", () => {
  it("R · nenhuma etapa is_won no funil, e ele funciona (lead nasce e anda)", async () => {
    const [n] = await q<{ n: string }>("select count(*)::text n from crm_stages where pipeline_id=$1 and is_won", [PIPE]);
    expect(n!.n).toBe("0");
    const l = await lead(await contato(), E.novo);
    expect(await mover(l, E.interessado)).toBeNull();
  });

  it("S · entrar em Alunos e responsáveis NÃO muda o lead para won", async () => {
    const l = await lead(await contato(), E.fechando);
    expect(await mover(l, E.alunos)).toBeNull();
    const [row] = await q<{ status: string; closed_at: string | null }>("select status, closed_at from crm_leads where id=$1", [l]);
    expect(row).toEqual({ status: "open", closed_at: null });
  });

  it("etapa acadêmica ou só-humana não pode ser ganho nem perda (CHECK)", async () => {
    await expect(q("update crm_stages set is_won=true where id=$1", [E.alunos])).rejects.toMatchObject({ code: "23514" });
    await expect(q("update crm_stages set is_lost=true where id=$1", [E.equipe])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("A–H, M, O, P — quem pode atender, decidido pela etapa", () => {
  it.each([
    ["A · Novo", "novo"],
    ["B · Interessado", "interessado"],
    ["C · Fechando condições", "fechando"],
  ] as const)("%s → comercial atende; acadêmico recusado", async (_c, etapa) => {
    const ct = await contato();
    await lead(ct, E[etapa]);
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("autorizado");
    expect(await pode(inbound, ACADEMICO.agent)).toBe("agente_fora_do_escopo_da_etapa");
    expect(await pode(inbound, null)).toBe("autorizado");
  });

  it("D · Desistiu (lead fechado como perda) → nenhuma IA", async () => {
    const ct = await contato();
    await lead(ct, E.desistiu, { status: "lost" });
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("etapa_sem_ia");
    expect(await pode(inbound, null)).toBe("etapa_sem_ia");
  });

  it("E/O · Desqualificado (spam) → nenhuma IA, nem com agente resolvido", async () => {
    const ct = await contato();
    await lead(ct, E.desqualificado);
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("etapa_sem_ia");
    expect(await pode(inbound, ACADEMICO.agent)).toBe("etapa_sem_ia");
    expect(await pode(inbound, null)).toBe("etapa_sem_ia");
  });

  it("F/P · Equipe (professor, funcionário, recepção) → nenhuma IA: só humano", async () => {
    const ct = await contato();
    await lead(ct, E.equipe);
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("etapa_so_humano");
    expect(await pode(inbound, ACADEMICO.agent)).toBe("etapa_so_humano");
    expect(await pode(inbound, null)).toBe("etapa_so_humano");
  });

  it("G/M · Alunos e responsáveis → agente comercial recusado", async () => {
    const ct = await contato();
    await lead(ct, E.alunos);
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("agente_fora_do_escopo_da_etapa");
  });

  it("H · Alunos e responsáveis → agente acadêmico atende (e o drain vê um agente elegível)", async () => {
    const ct = await contato();
    await lead(ct, E.alunos);
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, ACADEMICO.agent)).toBe("autorizado");
    expect(await pode(inbound, null)).toBe("autorizado");
  });

  it("sem agente acadêmico no ar, contato de Alunos não é atendido por ninguém", async () => {
    await q("update ai_agents set paused_at=now() where id=$1", [ACADEMICO.agent]);
    try {
      const ct = await contato();
      await lead(ct, E.alunos);
      const { inbound } = await conversaAtendida(ct);
      expect(await pode(inbound, null)).toBe("nenhum_agente_no_ar");
    } finally {
      await q("update ai_agents set paused_at=null where id=$1", [ACADEMICO.agent]);
    }
  });

  it("contato sem lead nenhum: comportamento de antes (comercial)", async () => {
    const ct = await contato();
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("autorizado");
  });

  it("quem desistiu e VOLTOU ganha lead novo: o lead aberto decide (comercial)", async () => {
    const ct = await contato();
    await lead(ct, E.desistiu, { status: "lost" });
    await lead(ct, E.novo);
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("autorizado");
  });

  it("entre leads abertos vale o mais restritivo (Equipe vence Novo)", async () => {
    const ct = await contato();
    await lead(ct, E.novo);
    await lead(ct, E.equipe);
    const { inbound } = await conversaAtendida(ct);
    expect(await pode(inbound, null)).toBe("etapa_so_humano");
  });
});

describe("D/E/F/G/Q — follow-up só em etapa comercial, em qualquer gatilho", () => {
  it.each([
    ["novo", "autorizado"],
    ["interessado", "autorizado"],
    ["fechando", "autorizado"],
    ["desqualificado", "etapa_fora_do_follow_up"],
    ["equipe", "etapa_fora_do_follow_up"],
    ["alunos", "etapa_fora_do_follow_up"],
  ] as const)("Q · %s → varredura de silêncio: %s", async (etapa, esperado) => {
    const ct = await contato();
    await lead(ct, E[etapa]);
    const { conv } = await conversaAtendida(ct);
    expect(await silencio(conv)).toBe(esperado);
  });

  it("D · Desistiu → varredura de silêncio recusa", async () => {
    const ct = await contato();
    await lead(ct, E.desistiu, { status: "lost" });
    const { conv } = await conversaAtendida(ct);
    expect(await silencio(conv)).toBe("etapa_fora_do_follow_up");
  });

  it.each(["silence", "manual"] as const)(
    "envio de follow-up (gatilho %s) recusado fora da etapa comercial; permitido em Interessado",
    async (gatilho) => {
      for (const etapa of ["desqualificado", "equipe", "alunos"] as const) {
        const ct = await contato();
        await lead(ct, E[etapa]);
        const { conv } = await conversaAtendida(ct);
        expect(await envioDeFollowup(ct, conv, gatilho), etapa).toBe("etapa_fora_do_follow_up");
      }
      const ct = await contato();
      await lead(ct, E.interessado);
      const { conv } = await conversaAtendida(ct);
      expect(await envioDeFollowup(ct, conv, gatilho)).toBe("autorizado");
    },
  );
});

describe("I/J/K/L — quem entra em Alunos e responsáveis não sai (qualquer escritor)", () => {
  it("mover para QUALQUER outra etapa é recusado pelo banco (PT423)", async () => {
    const l = await lead(await contato(), E.alunos);
    for (const destino of [E.novo, E.interessado, E.fechando, E.desistiu, E.desqualificado, E.equipe]) {
      expect(await mover(l, destino)).toBe("PT423");
    }
    const [row] = await q<{ stage_id: string }>("select stage_id from crm_leads where id=$1", [l]);
    expect(row!.stage_id).toBe(E.alunos);
  });

  it("trocar de funil também é saída, e é recusado", async () => {
    const outro = randomUUID();
    const etapaDoOutro = randomUUID();
    await q("insert into crm_pipelines(id,organization_id,name,slug) values($1,$2,'Outro','outro')", [outro, ORG]);
    await q("insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'A','etapa-a',1000)", [
      etapaDoOutro, ORG, outro,
    ]);
    const l = await lead(await contato(), E.alunos);
    await expect(
      q("update crm_leads set pipeline_id=$2, stage_id=$3 where id=$1", [l, outro, etapaDoOutro]),
    ).rejects.toMatchObject({ code: "PT423" });
  });

  it("controle: o mesmo UPDATE de uma etapa NÃO travada passa, e editar outros campos do lead travado passa", async () => {
    const livre = await lead(await contato(), E.novo);
    expect(await mover(livre, E.fechando)).toBeNull();
    const preso = await lead(await contato(), E.alunos);
    await q("update crm_leads set title='Renomeado' where id=$1", [preso]);
    const [row] = await q<{ title: string }>("select title from crm_leads where id=$1", [preso]);
    expect(row!.title).toBe("Renomeado");
  });

  it("a trava é da ETAPA: destravar a etapa (ação administrativa) libera o card", async () => {
    const l = await lead(await contato(), E.alunos);
    await q("update crm_stages set exit_locked=false where id=$1", [E.alunos]);
    try {
      expect(await mover(l, E.novo)).toBeNull();
    } finally {
      await q("update crm_stages set exit_locked=true where id=$1", [E.alunos]);
    }
  });
});

describe("as funções novas nascem fechadas para a REST", () => {
  it.each([
    "public.fn_politica_de_atendimento_do_contato(uuid,uuid)",
    "public.fn_crm_leads_trava_de_saida()",
  ])("%s: anon e authenticated sem EXECUTE", async (fn) => {
    for (const papel of ["anon", "authenticated"]) {
      const [r] = await q<{ pode: boolean }>("select has_function_privilege($1, $2, 'EXECUTE') pode", [papel, fn]);
      expect(r!.pode, `${papel} em ${fn}`).toBe(false);
    }
  });
});
