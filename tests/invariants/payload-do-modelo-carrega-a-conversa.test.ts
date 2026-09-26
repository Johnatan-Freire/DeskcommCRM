/**
 * O INPUT FINAL ENTREGUE AO MODELO carrega a conversa — não basta "getLeadContext
 * foi chamado".
 *
 * Roda o `inbound_turn` REAL (`createInboundTurnHandler`) contra o Postgres do
 * baseline, com o modelo trocado por um registry falso que GUARDA o prompt que
 * recebe. O que se afirma é sobre esse prompt — o mesmo objeto que iria à API.
 *
 * A cena é a do incidente de 2026-09-26, com os números do pedido:
 *
 *   HUMANO (celular, abre a conversa): "O curso de Programação custa R$ 900."
 *     — sent_at ~2s ANTES do início do episódio, como medido em produção
 *   IA:      "Posso te ajudar com mais alguma coisa sobre o curso?"
 *   CLIENTE: "Vou pensar."
 *   [agente ativado]
 *   CLIENTE: "E posso parcelar?"
 *
 * E o outro lado: se o contexto NÃO carrega, o modelo NÃO é chamado — nem com a
 * mensagem atual sozinha (fail-closed).
 *
 * NÃO MEDIDO: a qualidade da resposta do modelo. Sem API paga; o que se prova é
 * que ele recebe o necessário para responder com continuidade.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

import { publicarAgenteNaSessao } from "./agente-no-ar";
import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";
import type * as LeadContext from "@/lib/agent-engine/edge/crm/get-lead-context";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

/**
 * Falha de contexto sob demanda. O módulo real é usado SEMPRE, exceto quando o
 * caso pede a falha — então o payload do caso feliz é o da cadeia real.
 */
const falhaDoContexto: { modo: "nenhuma" | "erro" | "excecao" } = { modo: "nenhuma" };
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", async (importOriginal) => {
  const real = await importOriginal<typeof LeadContext>();
  return {
    ...real,
    getLeadContext: async (...args: Parameters<typeof real.getLeadContext>) => {
      if (falhaDoContexto.modo === "erro") {
        return { ok: false as const, error: { code: "crm_unavailable" as const, message: "CRM fora" } };
      }
      if (falhaDoContexto.modo === "excecao") throw new Error("banco caiu no meio do contexto");
      return real.getLeadContext(...args);
    },
  };
});

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 3 });

const ORG = randomUUID();
const CONTACT = randomUUID();
const SESSION = randomUUID();
const CONV = randomUUID();
const MSG_ATUAL = randomUUID();
const NOME_DO_CLIENTE = "Maria Aparecida Teste";

const ABERTURA_HUMANA = "O curso de Programação custa R$ 900.";
const FALA_DA_IA = "Posso te ajudar com mais alguma coisa sobre o curso?";
const FALA_ANTIGA_DO_CLIENTE = "Vou pensar.";
const MENSAGEM_ATUAL = "E posso parcelar?";

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

interface Chamada { prompt: unknown; tools: string[] }
let chamadas: Chamada[] = [];

const CHECKPOINT = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: "teste" });
const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** Modelo que só GUARDA o que recebe e encerra — nenhum envio sai. */
async function modeloQueGuarda(opts: { prompt?: unknown; tools?: Array<{ name?: string }> }) {
  chamadas.push({ prompt: opts.prompt, tools: (opts.tools ?? []).map((t) => String(t.name)) });
  return {
    content: [{ type: "text" as const, text: CHECKPOINT }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: USO,
    warnings: [],
  };
}

const enviados: string[] = [];
function handler() {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 20,
      maxContextTokens: 8000,
      notesIndexMaxTokens: 500,
      maxSteps: 4,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2, exactFailureBlock: 5, sameToolFailureWarn: 3,
        sameToolFailureHalt: 8, noProgressWarn: 3, noProgressBlock: 5,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(modeloQueGuarda as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          enviados.push(i.body);
          return { kind: "sent" as const, idempotencyKey: `k${enviados.length}`, messageId: `m${enviados.length}` };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    // Terça 15h BRT: dentro da janela anti-ban — senão o turno é adiado antes do modelo.
    clock: () => new Date("2026-07-28T18:00:00Z"),
    sleep: async () => {},
  });
}

async function rodaTurno(): Promise<Error | null> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: CONTACT,
    payload: {
      conversation_id: CONV, contact_id: CONTACT, channel_session_id: SESSION,
      inbound_message_id: MSG_ATUAL, crm_event_id: randomUUID(),
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "payload", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await handler()(claimed!, pool, { workerId: "payload" });
    await m.queue.completeJob(pool, claimed!.id, "payload");
    return null;
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "payload", err);
    return err as Error;
  }
}

/** A chamada DO TURNO: a que oferece `send_message` ao modelo. */
function chamadaDoTurno(): Chamada {
  const turno = chamadas.find((c) => c.tools.includes("send_message"));
  if (!turno) throw new Error(`nenhuma chamada do turno; ferramentas vistas: ${JSON.stringify(chamadas.map((c) => c.tools))}`);
  return turno;
}

async function msg(o: {
  direction: "inbound" | "outbound"; sentVia: string; body: string; sentAt: Date; createdAt: Date; id?: string;
}) {
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at, created_at)
     values ($1,$2,$3,$4,$5,'text',$6,$7,$8,$9,$10,$11)`,
    [o.id ?? randomUUID(), ORG, CONV, SESSION, CONTACT, o.direction,
     o.direction === "inbound" ? "delivered" : "sent", o.body, o.sentVia,
     o.sentAt.toISOString(), o.createdAt.toISOString()],
  );
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn")).createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };
  await pool.query(
    "insert into organizations (id, slug, legal_name, display_name) values ($1,$2,'Payload','Payload')",
    [ORG, `payload-${ORG}`],
  );
  await pool.query(
    "insert into contacts (id, organization_id, name, phone_number) values ($1,$2,$3,'+5561988887777')",
    [CONTACT, ORG, NOME_DO_CLIENTE],
  );
  const conectou = new Date(Date.now() - 7 * 86_400_000);
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted, first_connected_at)
     values ($1,$2,$3,'WORKING','\\x00'::bytea,$4)`,
    [SESSION, ORG, `payload-${SESSION}`, conectou.toISOString()],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'open',false)`,
    [CONV, ORG, CONTACT, SESSION],
  );
  // A conversa começou 2h atrás, com o HUMANO abrindo pelo celular. Episódio
  // carimbado na persistência: 1,8s depois do horário real do WhatsApp (medido).
  const t0 = new Date(Date.now() - 2 * 3_600_000);
  const seg = (s: number) => new Date(t0.getTime() + s * 1000);
  await msg({ direction: "outbound", sentVia: "external_device", body: ABERTURA_HUMANA, sentAt: t0, createdAt: seg(2.3) });
  await pool.query("update conversations set service_started_at=$2 where id=$1", [CONV, seg(1.8).toISOString()]);
  await msg({ direction: "outbound", sentVia: "ai", body: FALA_DA_IA, sentAt: seg(60), createdAt: seg(60.2) });
  await msg({ direction: "inbound", sentVia: "external_device", body: FALA_ANTIGA_DO_CLIENTE, sentAt: seg(120), createdAt: seg(120.2) });
  // O agente é ligado AGORA — depois de tudo acima.
  await publicarAgenteNaSessao(pool, ORG, SESSION);
  const agora = new Date();
  await msg({ id: MSG_ATUAL, direction: "inbound", sentVia: "external_device", body: MENSAGEM_ATUAL, sentAt: agora, createdAt: agora });
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

beforeEach(() => {
  chamadas = [];
  enviados.length = 0;
  falhaDoContexto.modo = "nenhuma";
});

describe("o prompt do turno carrega a conversa anterior", () => {
  it("⭐ curso, preço, a fala do cliente, a fala da IA e a pergunta nova estão no INPUT FINAL do modelo", async () => {
    expect(await rodaTurno()).toBeNull();
    const prompt = JSON.stringify(chamadaDoTurno().prompt);

    expect(prompt, "abertura do HUMANO (curso + preço) — a que era cortada por ~2s").toContain(ABERTURA_HUMANA);
    expect(prompt).toContain("Programação");
    expect(prompt).toContain("R$ 900");
    expect(prompt, "fala anterior do CLIENTE").toContain(FALA_ANTIGA_DO_CLIENTE);
    expect(prompt, "fala anterior da IA").toContain(FALA_DA_IA);
    expect(prompt, "a mensagem que abriu o turno").toContain(MENSAGEM_ATUAL);
    expect(prompt, "dados do contato (lead context)").toContain(NOME_DO_CLIENTE);
    // Quem falou chega ROTULADO: atendente humano, "nós" (a IA) e cliente — o
    // modelo não confunde a fala do humano com a própria.
    expect(prompt).toContain(`\\"de\\":\\"atendente\\",\\"texto\\":\\"${ABERTURA_HUMANA}`);
    expect(prompt).toContain(`\\"de\\":\\"nós\\",\\"texto\\":\\"${FALA_DA_IA}`);
    expect(prompt).toContain(`\\"de\\":\\"cliente\\",\\"texto\\":\\"${FALA_ANTIGA_DO_CLIENTE}`);
  });

  it("ordem cronológica no prompt: abertura → IA → cliente → pergunta nova", async () => {
    expect(await rodaTurno()).toBeNull();
    const prompt = JSON.stringify(chamadaDoTurno().prompt);
    const pos = [ABERTURA_HUMANA, FALA_DA_IA, FALA_ANTIGA_DO_CLIENTE, MENSAGEM_ATUAL].map((t) => prompt.indexOf(t));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});

describe("falha ao carregar o contexto → o modelo NÃO é chamado (fail-closed)", () => {
  it("getLeadContext devolve erro: turno falha, zero chamada ao modelo, zero envio", async () => {
    falhaDoContexto.modo = "erro";
    const erro = await rodaTurno();
    expect(erro?.message).toMatch(/get_lead_context/);
    expect(chamadas.filter((c) => c.tools.includes("send_message"))).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it("getLeadContext lança: turno falha, zero chamada ao modelo, zero envio", async () => {
    falhaDoContexto.modo = "excecao";
    const erro = await rodaTurno();
    expect(erro?.message).toMatch(/banco caiu/);
    expect(chamadas.filter((c) => c.tools.includes("send_message"))).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it("CONTROLE: sem falha, o mesmo turno chama o modelo", async () => {
    expect(await rodaTurno()).toBeNull();
    expect(chamadas.some((c) => c.tools.includes("send_message"))).toBe(true);
  });
});

describe("truncamento da janela é coerente", () => {
  it("janela menor que a conversa: ficam as MAIS RECENTES, em ordem, terminando na mensagem atual", async () => {
    const { getLeadContext } = await vi.importActual<typeof LeadContext>("@/lib/agent-engine/edge/crm/get-lead-context");
    const r = await getLeadContext(pool, {} as never, { tenantId: ORG, leadId: CONTACT, conversationId: CONV, fuso: "America/Sao_Paulo" }, { historyLimit: 2, maxTokens: 8000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.messages.map((x) => x.body)).toEqual([FALA_ANTIGA_DO_CLIENTE, MENSAGEM_ATUAL]);
  });

  it("orçamento de tokens apertado: cai a MAIS ANTIGA primeiro, a atual nunca some", async () => {
    const { getLeadContext } = await vi.importActual<typeof LeadContext>("@/lib/agent-engine/edge/crm/get-lead-context");
    const r = await getLeadContext(pool, {} as never, { tenantId: ORG, leadId: CONTACT, conversationId: CONV, fuso: "America/Sao_Paulo" }, { historyLimit: 20, maxTokens: 150 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const corpos = r.context.messages.map((x) => x.body);
    // Quem fica é a MAIS RECENTE (no limite extremo, o corpo dela é encurtado —
    // desenho existente de `fitToBudget`); as antigas saíram primeiro.
    expect(corpos).toHaveLength(1);
    expect(MENSAGEM_ATUAL.startsWith(corpos[0]!)).toBe(true);
  });

  it("…e mesmo assim a mensagem atual chega INTEIRA ao modelo, pelo bloco próprio da mensagem atual", async () => {
    expect(await rodaTurno()).toBeNull();
    const prompt = JSON.stringify(chamadaDoTurno().prompt);
    expect(prompt).toContain("Mensagem atual do cliente");
    expect(prompt).toContain(`{\\"texto\\":\\"${MENSAGEM_ATUAL}\\"}`);
  });
});
