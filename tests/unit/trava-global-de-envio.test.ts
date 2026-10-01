/**
 * A TRAVA GLOBAL DE ENVIO (`lib/channels/envio-de-saida.ts`): com `OUTBOUND_MESSAGING`
 * diferente do literal `enabled`, NENHUMA mensagem de conversa chega ao provedor.
 *
 * A régua é o efeito externo: `fetch` global espionado — é por ele que toda saída
 * real deixa o processo (cliente WAHA, Graph, parceiros). Cada caso termina em
 * `fetch` chamado ZERO vezes com a trava fechada, e o controle positivo prova que
 * o mesmo cenário SAI com ela aberta — sem ele, zero chamadas não provaria nada.
 *
 * Duas camadas, porque uma sozinha não basta:
 *   - COMPORTAMENTO: cada emissor chega ao canal por uma de quatro portas
 *     (`sendMessageHandler`, `getAdapter`, `sendTemplateForSession`, o redrive do
 *     `session-reconciler`) — e cada porta é exercitada aqui fechada.
 *   - CERCA: o mapa "emissor → porta" é verificado no código. Um emissor novo que
 *     fale com o provedor por fora falha aqui antes de chegar a produção.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { redriveQueued } from "@/lib/agent-engine/edge/crm/session-reconciler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { getAdapter, PROVIDERS_DE_MENSAGEM } from "@/lib/channels";
import {
  CODIGO_ENVIO_DESLIGADO,
  EnvioDeSaidaDesligadoError,
  envioDeConversaLigado,
} from "@/lib/channels/envio-de-saida";
import { sendTemplateForSession } from "@/lib/channels/meta/send-template-for-session";
import type { SendMessageInput } from "@/lib/schemas";
import { WahaClient } from "@/lib/waha/client";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

// Os contextos de entrega (reunião, resposta aprovada, prospecção, operação do
// agente, efeito de agenda, fronteira do atendimento) são validados no INÍCIO do
// handler contra o banco. Aqui eles passam: o que está sob prova é só a trava.
vi.mock("@/lib/agenda/meet-delivery", async (orig) => ({
  ...(await orig<object>()),
  assertMeetingDeliverySupabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/replies/delivery", async (orig) => ({
  ...(await orig<object>()),
  assertApprovedReplySupabase: vi.fn(async () => {}),
  prepareApprovedReplySupabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/prospecting/guard", async (orig) => ({
  ...(await orig<object>()),
  assertProspectingDelivery: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/agents/operation", async (orig) => ({
  ...(await orig<object>()),
  assertAgentOperationSupabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/agenda/efeito", async (orig) => ({
  ...(await orig<object>()),
  assertAgendaEffectSupabase: vi.fn(async () => {}),
  guardAgendaEffect: vi.fn(async () => {}),
}));
vi.mock("@/lib/atendimento/origem", async (orig) => ({
  ...(await orig<object>()),
  assertServiceBoundarySupabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/a.jpg" }, error: null }) }) },
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const WAHA_BASE = "http://localhost:3030";

type Row = Record<string, unknown>;

function conversationRow(): Row {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    contacts: { phone_number: "+5531999998888", wa_identity: null, is_blocked: false },
    channel_sessions: { provider: "waha", waha_session_name: "default", status: "WORKING", archived_at: null },
  };
}

/** O dublê compartilhado do handler (a cerca `send-message-handler-nao-ganha-novo-duble` exige). */
function supabaseDoHandler(): SupabaseClient {
  return criarDubleDoHandler({ conversation: conversationRow() }).supabase;
}

function travaFechada() {
  vi.stubEnv("OUTBOUND_MESSAGING", "");
}
function wahaNoAr() {
  vi.stubEnv("WAHA_API_BASE_URL", WAHA_BASE);
  vi.stubEnv("WAHA_API_KEY", "hash123");
}
function espiarFio() {
  const fetchMock = vi.fn(async () => Response.json({ key: { id: "SAIU" }, id: { _serialized: "SAIU" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const texto = (over: Partial<SendMessageInput> = {}) =>
  ({ conversation_id: CONV, type: "text", body: "oi", ...over }) as SendMessageInput;

// ─── A régua da trava ────────────────────────────────────────────────────────

describe("envioDeConversaLigado — só o literal `enabled` liga", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["disabled", false],
    ["true", false],
    ["1", false],
    ["Enabled", false],
    ["enable", false],
    ["enabled", true],
    [" enabled ", true],
  ])("OUTBOUND_MESSAGING=%j → %s", (valor, esperado) => {
    expect(envioDeConversaLigado({ OUTBOUND_MESSAGING: valor } as unknown as NodeJS.ProcessEnv)).toBe(esperado);
  });
});

// ─── Porta 1: sendMessageHandler (hub de quase todo emissor) ─────────────────

/**
 * Cada emissor chega aqui com o seu ator e o seu contexto de entrega. A tabela é
 * o mapa do inventário: quem é o emissor real e como ele chama o handler.
 */
const EMISSORES_DO_HANDLER: Array<{ caso: string; ctx: Partial<HandlerCtx>; input?: Partial<SendMessageInput> }> = [
  { caso: "A · IA respondendo (turno inbound, send_message)", ctx: { actor: { type: "ai_agent", id: USER, role: "agent" } } },
  { caso: "A · IA com operação do agente carimbada", ctx: { actor: { type: "ai_agent", id: USER, role: "agent" }, agentOperation: { organizationId: ORG, agentId: USER, versionId: USER, revision: "1" } } },
  { caso: "B · follow-up (texto fixo / turno de follow-up)", ctx: { actor: { type: "webhook_source", id: USER }, proactiveContext: {} as never } },
  { caso: "C · automação (send-whatsapp / send-ai-message)", ctx: { actor: { type: "webhook_source", id: USER, textoEscritoPelaIA: true } } },
  { caso: "D · mensagem manual pela Inbox", ctx: { actor: { type: "user", id: USER } } },
  { caso: "D · mensagem manual via API token / MCP", ctx: { actor: { type: "api_token", id: USER } } },
  { caso: "E · aviso de passagem ao lead (handoff)", ctx: { actor: { type: "ai_agent", id: USER, role: "agent" } } },
  { caso: "F · resposta aprovada", ctx: { actor: { type: "ai_agent", id: USER, role: "agent" }, approvedReply: {} as never } },
  { caso: "G · entrega de reunião", ctx: { actor: { type: "ai_agent", id: USER, role: "agent" }, meetingDelivery: {} as never } },
  { caso: "J · prospecção", ctx: { actor: { type: "ai_agent", id: USER, role: "agent" }, prospectingDelivery: {} as never } },
  { caso: "J · mídia", ctx: { actor: { type: "user", id: USER } }, input: { type: "image", body: undefined, media_storage_path: `${ORG}/${CONV}/a.jpg`, media_mime: "image/jpeg" } },
  { caso: "J · modelo (template)", ctx: { actor: { type: "user", id: USER } }, input: { type: "template", body: undefined, template_name: "t", template_language: "pt_BR", template_values: {} } as Partial<SendMessageInput> },
];

describe("sendMessageHandler com a trava FECHADA — nada chega ao provedor", () => {
  it.each(EMISSORES_DO_HANDLER)("$caso → failed/outbound_disabled, PROVIDER_SEND_CALLS=0", async ({ ctx, input }) => {
    travaFechada();
    wahaNoAr();
    const fio = espiarFio();

    const msg = await sendMessageHandler(
      supabaseDoHandler(),
      { organization_id: ORG, requestId: "req", actor: { type: "user", id: USER }, ...ctx } as HandlerCtx,
      texto(input),
    );

    expect(msg.status).toBe("failed");
    expect(msg.error_code).toBe(CODIGO_ENVIO_DESLIGADO);
    expect(msg.external_id).toBeNull();
    expect(fio).not.toHaveBeenCalled();
  });

  it("controle: o MESMO cenário, com a trava aberta, sai pelo fio", async () => {
    wahaNoAr();
    const fio = espiarFio();
    const msg = await sendMessageHandler(
      supabaseDoHandler(),
      { organization_id: ORG, requestId: "req", actor: { type: "user", id: USER } },
      texto(),
    );
    expect(msg.status).toBe("sent");
    expect(fio).toHaveBeenCalled();
  });

  it("a trava vence a fila: canal fora do ar NÃO vira `queued` (seria reenviado na reconexão)", async () => {
    travaFechada();
    const fio = espiarFio();
    const msg = await sendMessageHandler(
      supabaseDoHandler(),
      { organization_id: ORG, requestId: "req", actor: { type: "ai_agent", id: USER, role: "agent" } },
      texto(),
    );
    expect(msg.status).toBe("failed");
    expect(msg.error_code).toBe(CODIGO_ENVIO_DESLIGADO);
    expect(fio).not.toHaveBeenCalled();
  });
});

// ─── Porta 2: getAdapter (fronteira final de todo adapter) ───────────────────

describe("getAdapter — send/sendTemplate de TODO provider lançam com a trava fechada", () => {
  it.each(PROVIDERS_DE_MENSAGEM)("%s: send nunca alcança o adapter cru", async (provider) => {
    travaFechada();
    const fio = espiarFio();
    const adapter = getAdapter(provider);
    const cru = Object.getPrototypeOf(adapter) as { send: (...a: unknown[]) => unknown };
    const espiaoCru = vi.spyOn(cru, "send");

    await expect(
      adapter.send({ organizationId: ORG, sessionRef: "s", to: "5531999998888@c.us", kind: "text", body: "oi" } as never),
    ).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    if (adapter.sendTemplate) {
      await expect(adapter.sendTemplate({} as never)).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    }
    expect(espiaoCru).not.toHaveBeenCalled();
    expect(fio).not.toHaveBeenCalled();
  });

  it("controle: com a trava aberta o adapter cru é chamado (o embrulho não engole o envio)", async () => {
    const adapter = getAdapter("waha");
    const cru = Object.getPrototypeOf(adapter) as { send: (...a: unknown[]) => Promise<unknown> };
    const espiaoCru = vi.spyOn(cru, "send").mockResolvedValue({ externalId: "X" });
    await expect(adapter.send({} as never)).resolves.toEqual({ externalId: "X" });
    expect(espiaoCru).toHaveBeenCalledTimes(1);
  });

  it.each(PROVIDERS_DE_MENSAGEM)("%s: editar e apagar mensagem entregue também ficam atrás da trava", async (provider) => {
    travaFechada();
    const fio = espiarFio();
    const adapter = getAdapter(provider);
    const cru = Object.getPrototypeOf(adapter) as { editMessage?: (...a: unknown[]) => unknown; revokeMessage?: (...a: unknown[]) => unknown };
    const espioes = (["editMessage", "revokeMessage"] as const)
      .filter((m) => typeof cru[m] === "function")
      .map((m) => vi.spyOn(cru as Record<string, (...a: unknown[]) => unknown>, m));
    if (adapter.editMessage) {
      await expect(adapter.editMessage({ text: "novo" } as never)).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    }
    if (adapter.revokeMessage) {
      await expect(adapter.revokeMessage({} as never)).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    }
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
    expect(fio).not.toHaveBeenCalled();
  });

  it("o resto do adapter segue intacto (codes, resolveRecipient)", () => {
    const adapter = getAdapter("waha");
    expect(adapter.codes.sendFailed).toBeTruthy();
    expect(adapter.resolveRecipient({ isGroup: false, groupChatId: null, phoneNumber: "+5531999998888", waIdentity: null, waLid: null } as never)).toBeTruthy();
  });
});

// ─── Porta 3: modelo sem adapter e o fio do cliente ──────────────────────────

describe("caminhos que falam com a plataforma sem o adapter", () => {
  it("J · sendTemplateForSession recusa antes de resolver credencial ou tocar a rede", async () => {
    travaFechada();
    const fio = espiarFio();
    await expect(
      sendTemplateForSession({} as SupabaseClient, {
        organizationId: ORG, sessionRef: "x", to: "5531999998888", name: "t", language: "pt_BR", values: {},
      } as never),
    ).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    expect(fio).not.toHaveBeenCalled();
  });

  it("J · o cliente do transporte recusa texto, mídia, cartão de contato, edição e remoção no último passo", async () => {
    travaFechada();
    const fio = espiarFio();
    const client = new WahaClient(WAHA_BASE, "k");
    await expect(client.sendMessage("default", "5531@c.us", "oi")).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    await expect(client.sendMedia("default", "5531@c.us", { endpoint: "/api/sendImage", payload: {} })).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    await expect(client.sendContactVcard("default", "5531@c.us", [])).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    await expect(client.editMessage("default", "5531@c.us", "true_5531@c.us_ABC", "novo")).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    await expect(client.deleteMessage("default", "5531@c.us", "true_5531@c.us_ABC")).rejects.toBeInstanceOf(EnvioDeSaidaDesligadoError);
    expect(fio).not.toHaveBeenCalled();
  });
});

// ─── Porta 4: redrive da fila (retry / job antigo) ───────────────────────────

describe("H/I · redrive de `queued` com a trava fechada", () => {
  function poolFalso() {
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      async query(sql: string, params: unknown[] = []) {
        if (/^\s*update messages/i.test(sql)) {
          updates.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("count(*)::text as n")) return { rows: [{ n: "0" }] };
        if (sql.includes("extract(epoch")) {
          return { rows: [{ metadata: {}, phone_number: "+5531999998888", idade_ms: "120000" }] };
        }
        return {
          rows: [{
            id: "msg-velha", organization_id: ORG, conversation_id: CONV, body: "lembrete antigo",
            waha_session_name: "default", wa_identity: null, wa_lid: null, phone_number: "+5531999998888",
            is_group: false, group_chat_id: null,
          }],
        };
      },
    };
    return { pool: pool as unknown as pg.Pool, updates };
  }
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const cfg = { wahaBaseUrl: WAHA_BASE, wahaApiKey: "k", intervalMs: 1000, redriveMinAgeMs: 0, redriveBatchSize: 10, redriveSpacingMs: 0 };

  it("mensagem represada NÃO sai; vira failed/outbound_disabled (não fica à espera de religar)", async () => {
    travaFechada();
    const fio = espiarFio();
    const { pool, updates } = poolFalso();
    const enviadas = await redriveQueued(pool, cfg, log);
    expect(enviadas).toBe(0);
    expect(fio).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sql).toMatch(/status = 'failed'/);
    expect(updates[0]!.params).toContain(CODIGO_ENVIO_DESLIGADO);
  });

  it("controle: com a trava aberta o mesmo lote vai ao fio", async () => {
    const fio = espiarFio();
    const { pool } = poolFalso();
    await redriveQueued(pool, cfg, log);
    expect(fio).toHaveBeenCalled();
  });
});

// ─── A cerca: nenhum emissor fala com o provedor por fora das portas ─────────

const RAIZ = process.cwd();
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8");

describe("cerca — o mapa emissor → porta travada vale no código", () => {
  it("cada emissor conhecido chega ao canal por uma porta travada", () => {
    const PORTAS = /sendMessageHandler\(|sendTurnMessage\(|getAdapter\(|createRuntimeSendChannel\(|new WahaChannelAdapter\(|liveChannel\(\)\.send\(|channel\.send\(|opts\.channel\.send\(/;
    const EMISSORES = [
      "app/api/v1/messages/route.ts", // D · Inbox / API
      "lib/mcp/tools/messages.ts", // D · MCP
      "lib/mcp/tools/start-conversation.ts", // D · MCP
      "lib/ai/runtime/finalize.ts", // A · runtime legado
      "lib/agent-engine/edge/crm/send-message.ts", // A/B/E/F/G/I · agent-engine → handler
      "lib/agent-engine/edge/channel/waha-adapter.ts", // A/B/E/F/G/I · porta do agent-engine
      "lib/channels/runtime.ts", // F/G · resposta aprovada e reunião
      "lib/followup/enviar-texto-fixo.ts", // B · follow-up de texto fixo
      "lib/automation/actions/send-whatsapp.ts", // C
      "lib/automation/actions/send-ai-message.ts", // C
      "lib/ai/handoff/aviso-ao-lead.ts", // E
      "lib/escalacao/aviso-ao-suporte.handler.ts", // E · aviso ao suporte
      "lib/campanhas/acoes.ts", // J · campanha
      "lib/campanhas/rodada.ts", // J · campanha
      "lib/prospecting/worker.ts", // J · prospecção
      "app/api/v1/cron/agenda-reminder/route.ts", // J · lembrete de agenda
      "app/api/v1/messages/[id]/route.ts", // K · editar/apagar mensagem enviada (upstream #1626)
    ];
    for (const f of EMISSORES) expect(ler(f), f).toMatch(PORTAS);
  });

  it("as portas travadas continuam travadas", () => {
    expect(ler("app/api/v1/messages/_handler.ts")).toMatch(/if \(!envioDeConversaLigado\(\)\) \{/);
    expect(ler("lib/channels/index.ts")).toMatch(/atrasDaTravaDeSaida\(adapter\)/);
    expect(ler("lib/channels/meta/send-template-for-session.ts")).toMatch(/exigirEnvioDeConversaLigado\(\)/);
    expect(ler("lib/agent-engine/edge/crm/session-reconciler.ts")).toMatch(/if \(!envioDeConversaLigado\(\)\)/);
    // texto, mídia, cartão de contato, edição e remoção (as duas do upstream #1626)
    expect(ler("lib/waha/client.ts").match(/exigirEnvioDeConversaLigado\(\)/g)?.length).toBe(5);
    // o embrulho do seam cobre editar e apagar, não só send/sendTemplate
    expect(ler("lib/channels/index.ts").match(/exigirEnvioDeConversaLigado\(\)/g)?.length).toBe(4);
  });

  it("ninguém importa um adapter cru fora do próprio seam", async () => {
    const { execSync } = await import("node:child_process");
    const saida = execSync(
      `git grep -lE 'from "(\\./|\\.\\./|@/lib/channels/)(adapters/(waha|meta-cloud|zernio|datafy)|social/adapter)"' -- 'app/**/*.ts' 'app/**/*.tsx' 'lib/**/*.ts' 'workers/**/*.ts' || true`,
      { cwd: RAIZ, encoding: "utf8" },
    );
    const arquivos = saida.split("\n").filter((l) => l && !/\.test\.tsx?$/.test(l));
    expect(arquivos.sort()).toEqual(["lib/channels/index.ts", "lib/channels/social/adapter.ts"]);
  });

  it("os endpoints de envio do transporte só aparecem em código travado", async () => {
    const { execSync } = await import("node:child_process");
    const saida = execSync(
      `git grep -lE '/api/send[A-Z]' -- 'app/**/*.ts' 'lib/**/*.ts' 'workers/**/*.ts' || true`,
      { cwd: RAIZ, encoding: "utf8" },
    );
    const arquivos = saida.split("\n").filter((l) => l && !/\.test\.tsx?$/.test(l));
    const TRAVADOS_OU_SO_COMENTARIO = [
      "lib/agent-engine/edge/crm/session-reconciler.ts",
      "lib/channels/adapters/waha.ts", // passa o endpoint ao cliente travado
      "lib/channels/waha-media-plan.ts",
      "lib/waha/client.ts",
      "lib/waha/contact-card.ts", // só comentário
      "lib/waha/media-send.ts",
    ];
    for (const f of arquivos) expect(TRAVADOS_OU_SO_COMENTARIO, `${f} fala com o endpoint de envio`).toContain(f);
  });

  it("os métodos de envio do cliente do transporte só são chamados pelo adapter (ou pelo helper sem uso)", async () => {
    const { execSync } = await import("node:child_process");
    const saida = execSync(
      `git grep -lE '\\.(sendMessage|sendMedia|sendContactVcard)\\(' -- 'app/**/*.ts' 'lib/**/*.ts' 'workers/**/*.ts' || true`,
      { cwd: RAIZ, encoding: "utf8" },
    );
    const arquivos = saida.split("\n").filter((l) => l && !/\.test\.tsx?$/.test(l));
    expect(arquivos.sort()).toEqual(["lib/channels/adapters/waha.ts", "lib/waha/send.ts"]);
  });
});
