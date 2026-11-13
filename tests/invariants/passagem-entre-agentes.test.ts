/**
 * PASSAGEM DE CONVERSA ENTRE AGENTES (migration 8004), contra Postgres real com o
 * baseline que o self-hoster aplica.
 *
 * O caso que motivou: um aluno (contato em etapa acadêmica) pergunta de outro
 * curso. A etapa (0404) sempre escolhia o agente acadêmico, e a autorização da
 * resposta recusava o comercial (`agente_fora_do_escopo_da_etapa`). Com a
 * passagem gravada na conversa, quem atende é o agente que a recebeu, até o
 * atendimento ser encerrado.
 *
 * O que se prova aqui, todos na régua que o drain e o turno consultam
 * (`fn_ia_pode_responder_mensagem`) e na que o resolvedor lê
 * (`fn_agente_passado_da_conversa`):
 *   - a passagem troca o escopo exigido, nos dois sentidos;
 *   - encerrar a conversa acaba com ela, e reabrir não a ressuscita;
 *   - etapa só-humana continua vencendo a passagem;
 *   - agente pausado não segura a conversa;
 *   - a função nova não é alcançável pela anon key nem pela sessão;
 *   - a trilha (`ai_router_decisions`) é escrita só pelo servidor.
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
const E = { novo: randomUUID(), equipe: randomUUID(), alunos: randomUUID() };

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}
const depois = (s: number) => new Date(Date.now() + s * 1000).toISOString();

/** Contato com lead aberto na etapa, conversa aberta e uma mensagem do contato. */
async function cenario(etapa: string): Promise<{ contato: string; conv: string; inbound: string }> {
  const contato = randomUUID();
  await q("insert into contacts(id,organization_id,display_name,phone_number) values($1,$2,'Aluno',$3)", [
    contato, ORG, `+55619${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
  ]);
  await q(
    `insert into crm_leads(id,organization_id,contact_id,pipeline_id,stage_id,title,status)
     values($1,$2,$3,$4,$5,'Lead','open')`,
    [randomUUID(), ORG, contato, PIPE, etapa],
  );
  const conv = randomUUID();
  await q(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')",
    [conv, ORG, contato, SESSION],
  );
  const inbound = await mensagem(conv, contato, 2);
  return { contato, conv, inbound };
}
async function mensagem(conv: string, contato: string, segundos: number): Promise<string> {
  const id = randomUUID();
  await q(
    `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at)
     values($1,$2,$3,$4,$5,'text','inbound','received','external_device','quanto custa o curso de excel?',$6)`,
    [id, ORG, conv, SESSION, contato, depois(segundos)],
  );
  return id;
}
const passar = (conv: string, agente: string) =>
  q("update conversations set agente_passado_id=$2, agente_passado_em=clock_timestamp() where id=$1", [conv, agente]);
const pode = async (messageId: string, agentId: string | null) =>
  (await q<{ m: string }>("select public.fn_ia_pode_responder_mensagem($1,$2,$3) m", [ORG, messageId, agentId]))[0]!.m;
const passado = async (conv: string) =>
  (await q<{ a: string | null }>("select public.fn_agente_passado_da_conversa($1,$2) a", [ORG, conv]))[0]!.a;

beforeAll(async () => {
  await q("insert into organizations(id,display_name,legal_name,slug) values($1,'Escola','Escola',$2)", [ORG, `escola-${ORG}`]);
  await q(
    `insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted,status,first_connected_at)
     values($1,$2,$3,'\\x00'::bytea,'WORKING',$4)`,
    [SESSION, ORG, `passagem-${SESSION}`, CONECTOU],
  );
  await q("insert into crm_pipelines(id,organization_id,name,slug) values($1,$2,'Contatos','contatos')", [PIPE, ORG]);
  const etapas: Array<[string, string, string, number, string]> = [
    [E.novo, "Novo", "novo", 1000, "comercial"],
    [E.equipe, "Equipe", "chamar-humano", 2000, "humano"],
    [E.alunos, "Alunos e responsáveis", "alunos", 3000, "academico"],
  ];
  for (const [id, name, slug, position, politica] of etapas) {
    await q(
      `insert into crm_stages(id,organization_id,pipeline_id,name,slug,position,service_policy)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [id, ORG, PIPE, name, slug, position, politica],
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

describe("a passagem troca quem pode responder", () => {
  it("aluno sem passagem: só o acadêmico responde (o defeito de antes)", async () => {
    const { conv, inbound } = await cenario(E.alunos);
    expect(await passado(conv)).toBeNull();
    expect(await pode(inbound, ACADEMICO.agent)).toBe("autorizado");
    expect(await pode(inbound, COMERCIAL.agent)).toBe("agente_fora_do_escopo_da_etapa");
  });

  it("aluno passado ao Comercial: o comercial responde, e o acadêmico deixa de responder", async () => {
    const { conv, inbound } = await cenario(E.alunos);
    await passar(conv, COMERCIAL.agent);
    expect(await passado(conv)).toBe(COMERCIAL.agent);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("autorizado");
    expect(await pode(inbound, ACADEMICO.agent)).toBe("agente_fora_do_escopo_da_etapa");
    // O drain (sem agente resolvido) também enxerga um agente no ar do escopo certo.
    expect(await pode(inbound, null)).toBe("autorizado");
  });

  it("o sentido inverso também vale: lead comercial passado ao acadêmico", async () => {
    const { conv, inbound } = await cenario(E.novo);
    await passar(conv, ACADEMICO.agent);
    expect(await pode(inbound, ACADEMICO.agent)).toBe("autorizado");
    expect(await pode(inbound, COMERCIAL.agent)).toBe("agente_fora_do_escopo_da_etapa");
  });
});

describe("a passagem dura um atendimento", () => {
  it("encerrar a conversa acaba com a passagem, e reabrir não a ressuscita", async () => {
    const { contato, conv } = await cenario(E.alunos);
    await passar(conv, COMERCIAL.agent);
    expect(await passado(conv)).toBe(COMERCIAL.agent);

    await q("update conversations set status='closed' where id=$1", [conv]);
    expect(await passado(conv)).toBeNull();

    await q("update conversations set status='open' where id=$1", [conv]);
    expect(await passado(conv)).toBeNull();
    const nova = await mensagem(conv, contato, 5);
    expect(await pode(nova, COMERCIAL.agent)).toBe("agente_fora_do_escopo_da_etapa");
    expect(await pode(nova, ACADEMICO.agent)).toBe("autorizado");
  });

  it("passar de novo no atendimento reaberto volta a valer", async () => {
    const { conv } = await cenario(E.alunos);
    await passar(conv, COMERCIAL.agent);
    await q("update conversations set status='closed' where id=$1", [conv]);
    await q("update conversations set status='open' where id=$1", [conv]);
    await passar(conv, COMERCIAL.agent);
    expect(await passado(conv)).toBe(COMERCIAL.agent);
  });
});

describe("o que a passagem NÃO faz", () => {
  it("etapa só-humana continua vencendo: nenhuma IA responde", async () => {
    const { conv, inbound } = await cenario(E.equipe);
    await passar(conv, COMERCIAL.agent);
    expect(await pode(inbound, COMERCIAL.agent)).toBe("etapa_so_humano");
    expect(await pode(inbound, null)).toBe("etapa_so_humano");
  });

  it("agente pausado não segura a conversa: a etapa volta a decidir", async () => {
    const { conv, inbound } = await cenario(E.alunos);
    await passar(conv, COMERCIAL.agent);
    await q("update ai_agents set paused_at=now() where id=$1", [COMERCIAL.agent]);
    try {
      expect(await passado(conv)).toBeNull();
      expect(await pode(inbound, ACADEMICO.agent)).toBe("autorizado");
    } finally {
      await q("update ai_agents set paused_at=null where id=$1", [COMERCIAL.agent]);
    }
  });
});

describe("superfície", () => {
  it("fn_agente_passado_da_conversa só é executável pelo servidor", async () => {
    const [r] = await q<{ anon: boolean; auth: boolean; srv: boolean }>(
      `select has_function_privilege('anon', 'public.fn_agente_passado_da_conversa(uuid,uuid)', 'execute') anon,
              has_function_privilege('authenticated', 'public.fn_agente_passado_da_conversa(uuid,uuid)', 'execute') auth,
              has_function_privilege('service_role', 'public.fn_agente_passado_da_conversa(uuid,uuid)', 'execute') srv`,
    );
    expect(r).toEqual({ anon: false, auth: false, srv: true });
  });

  it("a trilha só tem policy PERMISSIVA de leitura: a sessão não grava passagem", async () => {
    // As `support_write_*` do modo suporte são RESTRICTIVE: só estreitam, nunca
    // concedem. Sem permissiva de escrita, a sessão não grava.
    const [r] = await q<{ cmds: string }>(
      `select string_agg(cmd, ',' order by cmd) cmds from pg_policies
        where schemaname='public' and tablename='ai_router_decisions' and permissive='PERMISSIVE'`,
    );
    expect(r!.cmds).toBe("SELECT");
  });

  it("a trilha aceita o desfecho e os campos da passagem, e recusa motivo fora do vocabulário", async () => {
    const { conv } = await cenario(E.alunos);
    await q(
      `insert into ai_router_decisions(organization_id,router_id,conversation_id,agent_id,outcome,origem,agente_anterior_id,motivo)
       values($1,null,$2,$3,'transferred','acao',$4,'pedido_do_agente')`,
      [ORG, conv, COMERCIAL.agent, ACADEMICO.agent],
    );
    await expect(
      q(
        `insert into ai_router_decisions(organization_id,conversation_id,agent_id,outcome,origem,motivo)
         values($1,$2,$3,'transferred','acao','porque sim')`,
        [ORG, conv, COMERCIAL.agent],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
