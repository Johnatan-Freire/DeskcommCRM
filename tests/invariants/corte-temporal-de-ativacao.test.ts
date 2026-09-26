/**
 * O CORTE TEMPORAL DE ATIVAÇÃO (migration 0403), contra Postgres real com o
 * baseline que o self-hoster aplica.
 *
 * A IA só atende mensagem que aconteceu DEPOIS de ser ligada — publicação,
 * despausa ou troca de modo. A fonte é `ai_agents.service_enabled_at`, gravada
 * SÓ por trigger; a decisão é `fn_ia_pode_responder_mensagem` (drain e turno),
 * `fn_silencio_pode_reengajar` (sweep) e `fn_followup_pode_enviar` (envio).
 *
 * O incidente que originou este arquivo (produção, 2026-09-26): o fluxo
 * "Lead sem resposta" reengajou conversas com o agente PAUSADO — conversas que
 * um humano encerrou ("Por nada ☺️") e conversas em handoff — e o contexto do
 * agente perdia a mensagem com que o humano ABRIA a conversa pelo celular.
 *
 * Os casos numerados (1–14) são os da especificação do dono do produto.
 *
 * NÃO MEDIDO AQUI: o comportamento do MODELO diante do contexto (caso 13 pede
 * "resposta demonstra continuidade"). O que se mede é que o contexto que CHEGA
 * ao modelo carrega a conversa anterior; a resposta do LLM exigiria avaliação
 * paga, fora do escopo desta suíte.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drainTick } from "@/lib/agent-engine/edge/crm/drain";
import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 5,
});

const noop = () => undefined;
const log = { info: noop, warn: noop, error: noop, debug: noop } as never;
const knobs = { batchSize: 10, intervalMs: 0, idleIntervalMs: 0, debounceMs: 0, reapTimeoutMs: 60_000 };

const ORG = randomUUID();
const SESSION = randomUUID();
const AGENT = randomUUID();
const VERSION = randomUUID();
/** O número conectou há 30 dias: o corte de CONEXÃO nunca é o que decide aqui. */
const CONECTOU = new Date(Date.now() - 30 * 86_400_000).toISOString();

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}

async function agente(): Promise<{ service_enabled_at: Date | null; paused_at: Date | null }> {
  return (await q("select service_enabled_at, paused_at from ai_agents where id=$1", [AGENT]))[0] as never;
}
async function ativacao(): Promise<Date> {
  const a = await agente();
  if (!a.service_enabled_at) throw new Error("agente sem ativação");
  return a.service_enabled_at;
}
const publicar = () => q("update ai_agents set published_version_id=$2, paused_at=null where id=$1", [AGENT, VERSION]);
const pausar = () => q("update ai_agents set paused_at=now() where id=$1", [AGENT]);
const despausar = () => q("update ai_agents set paused_at=null where id=$1", [AGENT]);
const despublicar = () => q("update ai_agents set published_version_id=null where id=$1", [AGENT]);

async function contato(): Promise<string> {
  const id = randomUUID();
  await q("insert into contacts(id,organization_id,display_name,phone_number) values($1,$2,'Lead',$3)", [
    id, ORG, `+55619${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
  ]);
  return id;
}
async function conversa(contactId: string, status = "open"): Promise<string> {
  const id = randomUUID();
  await q(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,$5)",
    [id, ORG, contactId, SESSION, status],
  );
  return id;
}
/** Mensagem com `sent_at` = horário REAL do WhatsApp; `created_at` opcional = hora da persistência. */
async function msg(
  conv: string,
  contactId: string,
  o: { direction?: "inbound" | "outbound"; sentVia?: string; sentAt: Date | string; createdAt?: Date; body?: string },
): Promise<string> {
  const id = randomUUID();
  const direction = o.direction ?? "inbound";
  await q(
    `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at,created_at)
     values($1,$2,$3,$4,$5,'text',$6,$7,$8,$9,$10,coalesce($11::timestamptz, now()))`,
    [
      id, ORG, conv, SESSION, contactId, direction,
      direction === "inbound" ? "received" : "sent",
      o.sentVia ?? (direction === "inbound" ? "external_device" : "ai"),
      o.body ?? "mensagem", typeof o.sentAt === "string" ? o.sentAt : o.sentAt.toISOString(),
      o.createdAt?.toISOString() ?? null,
    ],
  );
  return id;
}
const segundos = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const pode = async (messageId: string, agentId: string | null = null) =>
  (await q<{ m: string }>("select public.fn_ia_pode_responder_mensagem($1,$2,$3) m", [ORG, messageId, agentId]))[0]!.m;
const silencio = async (conv: string, inscrever = true) =>
  (await q<{ m: string }>("select public.fn_silencio_pode_reengajar($1,$2,$3) m", [ORG, conv, inscrever]))[0]!.m;

beforeAll(async () => {
  await q("insert into organizations(id,display_name,legal_name,slug) values($1,'Corte','Corte',$2)", [ORG, `corte-${ORG}`]);
  await q(
    `insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted,status,first_connected_at)
     values($1,$2,$3,'\\x00'::bytea,'WORKING',$4)`,
    [SESSION, ORG, `corte-${SESSION}`, CONECTOU],
  );
  await q(
    "insert into ai_agents(id,organization_id,name,system_prompt,kind) values($1,$2,'Agente','prompt','mcp_agent')",
    [AGENT, ORG],
  );
  await q(
    `insert into ai_agent_versions(id,organization_id,agent_id,version_number,system_prompt,provider,model,channel_session_id,status,published_at)
     values($1,$2,$3,1,'prompt','openai','gpt-4o-mini',$4,'published',now())`,
    [VERSION, ORG, AGENT, SESSION],
  );
});
afterAll(async () => {
  await pool.end();
});

describe("a fonte de verdade: ai_agents.service_enabled_at, só por trigger", () => {
  it("rascunho nasce sem autorização; publicar carimba; pausar zera; despausar carimba DE NOVO, mais tarde", async () => {
    await despublicar();
    expect((await agente()).service_enabled_at).toBeNull();
    await publicar();
    const primeira = await ativacao();
    await pausar();
    expect((await agente()).service_enabled_at, "pausado = sem autorização").toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await despausar();
    expect((await ativacao()).getTime(), "despausar reinicia o corte").toBeGreaterThan(primeira.getTime());
  });

  it("continuar no ar preserva — republicar/editar não reabre o passado, e a aplicação não move a data", async () => {
    await publicar();
    const antes = await ativacao();
    await q("update ai_agents set name='Agente renomeado', service_enabled_at='2000-01-01' where id=$1", [AGENT]);
    expect((await ativacao()).toISOString()).toBe(antes.toISOString());
  });

  it("trocar de modo (assistido ↔ automático) é começar a atender de outro jeito: reinicia o corte", async () => {
    const antes = await ativacao();
    await new Promise((r) => setTimeout(r, 20));
    await q("update ai_agents set operation_mode='assisted' where id=$1", [AGENT]);
    const assistido = await ativacao();
    expect(assistido.getTime()).toBeGreaterThan(antes.getTime());
    await new Promise((r) => setTimeout(r, 20));
    await q("update ai_agents set operation_mode='automatic' where id=$1", [AGENT]);
    expect((await ativacao()).getTime()).toBeGreaterThan(assistido.getTime());
  });
});

describe("fn_ia_pode_responder_mensagem — a régua da mensagem", () => {
  it("1 · mensagem 1s antes da ativação: NÃO responde", async () => {
    await publicar();
    const ativ = await ativacao();
    const ct = await contato();
    const cv = await conversa(ct);
    const m = await msg(cv, ct, { sentAt: segundos(ativ, -1) });
    expect(await pode(m)).toBe("anterior_a_ativacao");
    expect(await pode(m, AGENT)).toBe("anterior_a_ativacao");
  });

  it("2 · fronteira INCLUSIVA: mensagem no instante exato da ativação, e depois, respondem", async () => {
    const ativ = await ativacao();
    // O instante EXATO, em microssegundos — `Date` do JS truncaria para ms e
    // cairia antes da ativação.
    const [{ exato }] = await q<{ exato: string }>("select service_enabled_at::text exato from ai_agents where id=$1", [AGENT]);
    const ct = await contato();
    const cv = await conversa(ct);
    expect(await pode(await msg(cv, ct, { sentAt: exato! }))).toBe("autorizado");
    expect(await pode(await msg(cv, ct, { sentAt: segundos(ativ, 1) }), AGENT)).toBe("autorizado");
  });

  it("5 · histórico importado DEPOIS da ativação com horário real ANTERIOR: NÃO responde", async () => {
    const ativ = await ativacao();
    const ct = await contato();
    const cv = await conversa(ct);
    // Persistida agora (created_at = now()), aconteceu antes (sent_at): é histórico.
    const m = await msg(cv, ct, { sentAt: segundos(ativ, -3600), createdAt: new Date() });
    expect(await pode(m)).toBe("anterior_a_ativacao");
  });

  it("6 · mensagem nova persistida normalmente após a ativação: responde", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    expect(await pode(await msg(cv, ct, { sentAt: new Date() }))).toBe("autorizado");
  });

  it("7/8 · mensagens da PAUSA não são respondidas depois da despausa; a nova, sim", async () => {
    await publicar();
    const ct = await contato();
    const cv = await conversa(ct);
    await pausar();
    const naPausa = await msg(cv, ct, { sentAt: new Date() });
    expect(await pode(naPausa), "pausado: nenhum agente no ar").toBe("nenhum_agente_no_ar");
    expect(await pode(naPausa, AGENT)).toBe("agente_fora_do_ar");
    await new Promise((r) => setTimeout(r, 20));
    await despausar();
    expect(await pode(naPausa), "7 · backlog da pausa").toBe("anterior_a_ativacao");
    const nova = await msg(cv, ct, { sentAt: new Date() });
    expect(await pode(nova, AGENT), "8 · nova após a despausa").toBe("autorizado");
  });

  it("14 · horário no futuro (relógio adiantado): fail-closed", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    const m = await msg(cv, ct, { sentAt: new Date(Date.now() + 3_600_000) });
    expect(await pode(m)).toBe("horario_ambiguo");
  });

  it("14 · ativação desconhecida (agente no ar sem data — estado que só o backfill cobre): fail-closed", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    const m = await msg(cv, ct, { sentAt: new Date() });
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Desliga triggers SÓ nesta transação para forjar o estado; desfeito no rollback.
      await client.query("set local session_replication_role = replica");
      await client.query("update ai_agents set service_enabled_at=null where id=$1", [AGENT]);
      const { rows } = await client.query("select public.fn_ia_pode_responder_mensagem($1,$2,$3) m", [ORG, m, AGENT]);
      expect(rows[0].m).toBe("ativacao_desconhecida");
      const { rows: semAgente } = await client.query("select public.fn_ia_pode_responder_mensagem($1,$2,null) m", [ORG, m]);
      expect(semAgente[0].m).toBe("ativacao_desconhecida");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("mensagem que não é do contato e mensagem inexistente: nunca autorizam", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    expect(await pode(await msg(cv, ct, { direction: "outbound", sentAt: new Date() }))).toBe("nao_e_mensagem_do_contato");
    expect(await pode(randomUUID())).toBe("mensagem_desconhecida");
  });

  it("o corte de CONEXÃO (0398) continua valendo junto", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    const m = await msg(cv, ct, { sentAt: segundos(new Date(CONECTOU), -60) });
    expect(await pode(m)).toBe("anterior_a_conexao");
  });

  it("função nasce FECHADA para anon e authenticated (só service_role executa)", async () => {
    for (const fn of [
      "public.fn_ia_pode_responder_mensagem(uuid,uuid,uuid)",
      "public.fn_silencio_pode_reengajar(uuid,uuid,boolean)",
      "public.fn_followup_pode_enviar(uuid,uuid)",
    ]) {
      const [r] = await q<{ anon: boolean; auth: boolean; sr: boolean }>(
        `select has_function_privilege('anon',$1,'execute') anon,
                has_function_privilege('authenticated',$1,'execute') auth,
                has_function_privilege('service_role',$1,'execute') sr`,
        [fn],
      );
      expect(r, fn).toEqual({ anon: false, auth: false, sr: true });
    }
  });
});

describe("o drain de verdade — replay/redrive não atravessa o corte", () => {
  async function evento(conv: string, ct: string, messageId: string): Promise<string> {
    const id = randomUUID();
    await q(
      `insert into event_log(id,organization_id,event_type,entity_kind,entity_id,payload,status)
       values($1,$2,'ai_agent.dispatch_requested','message',$4,$3,'pending')`,
      [id, ORG, JSON.stringify({
        conversation_id: conv, contact_id: ct, channel_session_id: SESSION, inbound_message_id: messageId,
      }), messageId],
    );
    return id;
  }
  const jobs = async (eventId: string) =>
    (await q("select id from job_queue where organization_id=$1 and source_event_id=$2", [ORG, eventId])).length;
  const drenar = async (eventId: string) => {
    for (let i = 0; i < 20; i++) {
      await drainTick(pool, knobs, log);
      const [e] = await q<{ status: string }>("select status from event_log where id=$1", [eventId]);
      if (e?.status === "done" || e?.status === "dead") return e.status;
    }
    throw new Error("evento não terminou");
  };

  it("9 · evento de mensagem ANTERIOR à ativação (retry/redrive/replay): done, sem job", async () => {
    await publicar();
    const ativ = await ativacao();
    const ct = await contato();
    const cv = await conversa(ct);
    const m = await msg(cv, ct, { sentAt: segundos(ativ, -120) });
    const ev = await evento(cv, ct, m);
    expect(await drenar(ev)).toBe("done");
    expect(await jobs(ev)).toBe(0);
    // Redrive: o operador devolve o MESMO evento para pending. Continua barrado.
    await q("update event_log set status='pending', next_attempt_at=null where id=$1", [ev]);
    expect(await drenar(ev)).toBe("done");
    expect(await jobs(ev)).toBe(0);
  });

  it("7 · evento que chega com o agente PAUSADO vira done na hora — nada fica represado para a despausa", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    await pausar();
    const m = await msg(cv, ct, { sentAt: new Date() });
    const ev = await evento(cv, ct, m);
    expect(await drenar(ev)).toBe("done");
    await despausar();
    expect(await jobs(ev)).toBe(0);
  });

  it("CONTROLE: mensagem nova depois da ativação vira job", async () => {
    await publicar();
    const ct = await contato();
    const cv = await conversa(ct);
    const m = await msg(cv, ct, { sentAt: new Date() });
    const ev = await evento(cv, ct, m);
    expect(await drenar(ev)).toBe("done");
    expect(await jobs(ev)).toBe(1);
  });
});

describe("conversa antiga × mensagem nova — contexto", () => {
  it("3/4/12/13 · conversa em andamento com humano antes da ativação: a nova mensagem responde E o contexto traz a conversa", async () => {
    await pausar();
    const ct = await contato();
    const cv = await conversa(ct);
    const base = new Date(Date.now() - 3 * 3_600_000);
    await msg(cv, ct, { sentAt: base, body: "Quanto custa o curso de Informática?" });
    await msg(cv, ct, { direction: "outbound", sentVia: "external_device", sentAt: segundos(base, 300), body: "O curso sai por R$ 120 mensais." });
    const antiga = await msg(cv, ct, { sentAt: segundos(base, 1800), body: "Entendi, vou pensar." });
    await new Promise((r) => setTimeout(r, 20));
    await despausar();
    // 4 · conversa antiga SEM mensagem nova: nada a responder.
    expect(await pode(antiga, AGENT)).toBe("anterior_a_ativacao");
    // 3/12 · mensagem NOVA depois da ativação: responde.
    const nova = await msg(cv, ct, { sentAt: new Date(), body: "entendi, e posso parcelar?" });
    expect(await pode(nova, AGENT)).toBe("autorizado");
    // 13 · o contexto que chega ao modelo carrega a conversa anterior, humano incluído.
    const r = await getLeadContext(pool, {} as never, { tenantId: ORG, leadId: ct, conversationId: cv, fuso: "America/Sao_Paulo" }, { historyLimit: 20, maxTokens: 8000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const corpos = r.context.messages.map((m) => m.body);
    expect(corpos).toContain("Quanto custa o curso de Informática?");
    expect(corpos).toContain("O curso sai por R$ 120 mensais.");
    expect(corpos.at(-1)).toBe("entendi, e posso parcelar?");
    const humano = r.context.messages.find((m) => m.body.startsWith("O curso sai"));
    expect(humano?.sender_kind, "a fala do humano chega marcada como humana").toBe("human_agent");
  });

  it("a mensagem com que o HUMANO abre a conversa pelo celular entra no contexto (episódio nasce ~2s depois do sent_at)", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    const inicio = new Date(Date.now() - 600_000);
    await q("update conversations set service_started_at=$2 where id=$1", [cv, inicio.toISOString()]);
    // Medido em produção: sent_at 1,5–2,4s ANTES do início do episódio; created_at 0,2–0,6s DEPOIS.
    await msg(cv, ct, {
      direction: "outbound", sentVia: "external_device",
      sentAt: segundos(inicio, -2), createdAt: segundos(inicio, 0.4),
      body: "Olá! Seguem as informações do curso: R$ 126 em 7x.",
    });
    const r = await getLeadContext(pool, {} as never, { tenantId: ORG, leadId: ct, conversationId: cv, fuso: "America/Sao_Paulo" }, { historyLimit: 20, maxTokens: 8000 });
    expect(r.ok && r.context.messages.map((m) => m.body)).toContain("Olá! Seguem as informações do curso: R$ 126 em 7x.");
  });

  it("CONTROLE: fala de episódio ANTERIOR (persistida antes do início do episódio atual) continua fora", async () => {
    const ct = await contato();
    const cv = await conversa(ct);
    const inicio = new Date(Date.now() - 600_000);
    await q("update conversations set service_started_at=$2 where id=$1", [cv, inicio.toISOString()]);
    await msg(cv, ct, {
      direction: "outbound", sentVia: "ai",
      sentAt: segundos(inicio, -86_400), createdAt: segundos(inicio, -86_400),
      body: "PENDENCIA_DO_EPISODIO_ENCERRADO",
    });
    const r = await getLeadContext(pool, {} as never, { tenantId: ORG, leadId: ct, conversationId: cv, fuso: "America/Sao_Paulo" }, { historyLimit: 20, maxTokens: 8000 });
    expect(JSON.stringify(r)).not.toContain("PENDENCIA_DO_EPISODIO_ENCERRADO");
  });
});

describe("fn_silencio_pode_reengajar — o incidente do 'Lead sem resposta'", () => {
  /** Conversa em que a IA falou por último e o lead (depois da ativação) não respondeu. */
  async function aguardandoOLead(o: { status?: string } = {}) {
    await publicar();
    const ct = await contato();
    const cv = await conversa(ct, o.status ?? "open");
    // Depois da ativação vigente (que pode ter sido um instante atrás, na
    // despausa do caso anterior): inbound agora, resposta da IA 1s depois.
    const agora = new Date();
    await msg(cv, ct, { sentAt: agora, body: "oi, quero saber do curso" });
    await msg(cv, ct, { direction: "outbound", sentVia: "ai", sentAt: segundos(agora, 1), body: "Claro! Qual curso?" });
    // Status pedido é aplicado DEPOIS: inbound numa conversa encerrada a reabre
    // (semântica de reabertura do produto, trigger da ingestão).
    if (o.status && o.status !== "open") await q("update conversations set status=$2 where id=$1", [cv, o.status]);
    return { ct, cv };
  }

  it("CONTROLE: IA falou por último, lead calado, agente no ar → autorizado", async () => {
    const { cv } = await aguardandoOLead();
    expect(await silencio(cv)).toBe("autorizado");
  });

  it("⭐ humano encerrou a conversa ('Por nada ☺️' pelo celular) → NÃO reengaja", async () => {
    const { ct, cv } = await aguardandoOLead();
    await msg(cv, ct, { direction: "outbound", sentVia: "external_device", sentAt: segundos(new Date(), 2), body: "Por nada ☺️" });
    expect(await silencio(cv)).toBe("humano_falou_por_ultimo");
  });

  it("⭐ agente PAUSADO → NÃO reengaja, nem inscreve nem envia", async () => {
    const { cv } = await aguardandoOLead();
    await pausar();
    expect(await silencio(cv, true)).toBe("nenhum_agente_no_ar");
    expect(await silencio(cv, false)).toBe("nenhum_agente_no_ar");
    await despausar();
  });

  it("⭐ bot silenciado por handoff, dono humano, force_human → NÃO reengaja", async () => {
    const a = await aguardandoOLead();
    await q("update conversations set bot_silenced_until='infinity' where id=$1", [a.cv]);
    expect(await silencio(a.cv)).toBe("humano_atendendo");
    const b = await aguardandoOLead();
    await q("update contacts set force_human=true where id=$1", [b.ct]);
    expect(await silencio(b.cv)).toBe("humano_atendendo");
  });

  it("o lead falou por último e ninguém respondeu → não é 'lead sem resposta'", async () => {
    const { ct, cv } = await aguardandoOLead();
    await msg(cv, ct, { sentAt: segundos(new Date(), 2), body: "e aí?" });
    expect(await silencio(cv)).toBe("contato_aguardando_resposta");
  });

  it("10 · conversa ENCERRADA → NÃO reengaja", async () => {
    const { cv } = await aguardandoOLead({ status: "closed" });
    expect(await silencio(cv)).toBe("conversa_encerrada");
  });

  it("4/10 · último inbound de ANTES da ativação (conversa antiga, sem mensagem nova) → NÃO reengaja", async () => {
    const { cv } = await aguardandoOLead();
    await pausar();
    await new Promise((r) => setTimeout(r, 20));
    await despausar();
    expect(await silencio(cv)).toBe("anterior_a_ativacao");
  });

  it("11 · conversa encerrada que recebe mensagem NOVA e é reaberta segue a régua normal", async () => {
    const { ct, cv } = await aguardandoOLead({ status: "closed" });
    expect(await silencio(cv), "encerrada, sem mensagem nova").toBe("conversa_encerrada");
    const nova = await msg(cv, ct, { sentAt: segundos(new Date(), 2), body: "voltei, ainda tem vaga?" });
    expect(await pode(nova, AGENT), "a mensagem nova pode ser respondida").toBe("autorizado");
    const [{ status }] = await q<{ status: string }>("select status from conversations where id=$1", [cv]);
    expect(status, "a mensagem nova reabre a conversa (semântica do produto)").not.toBe("closed");
    await msg(cv, ct, { direction: "outbound", sentVia: "ai", sentAt: segundos(new Date(), 3), body: "Tem sim!" });
    expect(await silencio(cv)).toBe("autorizado");
  });

  it("um reengajamento por silêncio: o próprio lembrete não reabre a porta para o próximo sweep", async () => {
    const { ct, cv } = await aguardandoOLead();
    const [versao] = await q<{ id: string }>(
      "insert into followup_flow_versions(organization_id,graph) values($1,'{\"nodes\":[],\"edges\":[]}') returning id",
      [ORG],
    );
    const [ponteiro] = await q<{ id: string }>(
      `insert into followup_flow_pointers(organization_id,name,status,active_version_id,trigger_config)
       values($1,$2,'active',$3,'{"kind":"silence","params":{"threshold_minutes":1440}}') returning id`,
      [ORG, `silencio-${randomUUID()}`, versao!.id],
    );
    const [inscricao] = await q<{ id: string }>(
      `insert into followup_enrollments(organization_id,pointer_id,version_id,contact_id,conversation_id,current_node_id,status,started_at)
       values($1,$2,$3,$4,$5,'trigger','completed',now()) returning id`,
      [ORG, ponteiro!.id, versao!.id, ct, cv],
    );
    await msg(cv, ct, { direction: "outbound", sentVia: "automation", sentAt: segundos(new Date(), 2), body: "Oi! Vi que você tinha interesse…" });
    expect(await silencio(cv, true), "inscrever de novo").toBe("ja_reengajado_neste_silencio");
    // O ENVIO do segundo lembrete da mesma inscrição continua permitido…
    const envio = async () =>
      (await q<{ m: string }>("select public.fn_followup_pode_enviar($1,$2) m", [ORG, inscricao!.id]))[0]!.m;
    expect(await envio()).toBe("autorizado");
    // …até o fluxo ser DESLIGADO, ou um humano falar, ou o agente pausar.
    await q("update followup_flow_pointers set status='disabled' where id=$1", [ponteiro!.id]);
    expect(await envio()).toBe("fluxo_desligado");
    await q("update followup_flow_pointers set status='active' where id=$1", [ponteiro!.id]);
    await pausar();
    expect(await envio()).toBe("nenhum_agente_no_ar");
    await despausar();
  });
});
