import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  reconcileSessions,
  redriveQueued,
  type WatchdogConfig,
} from "@/lib/agent-engine/edge/crm/session-reconciler";
import { createLogger } from "@/lib/agent-engine/obs/logger";

/**
 * Fase 4A-2 — watchdog de sessão (o incidente real do Carlos, congelado em teste).
 *
 * Fixture: WAHA-mock local diz WORKING; o espelho channel_sessions diz STARTING;
 * uma resposta AI está presa em `queued`. O watchdog deve (1) reconciliar o
 * espelho e (2) reenviar a mensagem — que sai `sent` COM external_id extraído
 * do shape NOWEB. Regressão aqui = lead no vácuo de novo.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:invariants` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});
const log = createLogger();

const ORG = "bbbbbbbb-0000-4000-8000-000000000001";
const CONTACT = "bbbbbbbb-0000-4000-8000-000000000002";
const SESSION = "bbbbbbbb-0000-4000-8000-000000000003";
const CONV = "bbbbbbbb-0000-4000-8000-000000000004";
const QUEUED_MSG = "bbbbbbbb-0000-4000-8000-000000000005";
const WAHA_SESSION_NAME = "watchdog-proof-session";
const NOWEB_ID = "3EB0WATCHDOGPROOF";

// Fixtures do #196 (upstream) — reconexão/eco duplicava a resposta da IA.
const NOWEB_ECHO_CONTACT = "bbbbbbbb-0000-4000-8000-000000000007";
const NOWEB_ECHO_CONV = "bbbbbbbb-0000-4000-8000-000000000008";
const NOWEB_ECHO_QUEUED_MSG = "bbbbbbbb-0000-4000-8000-000000000009";
const NOWEB_ECHO_ROW = "bbbbbbbb-0000-4000-8000-00000000000a";
const NOWEB_ECHO_PHONE = "+5511900000098";
const NOWEB_ECHO_CHAT_ID = "5511900000098@c.us";
const NOWEB_ECHO_BARE_ID = "3EB0NOWEBECHOPROOF";
const NOWEB_ECHO_COMPOSITE_ID = `true_${NOWEB_ECHO_CHAT_ID}_${NOWEB_ECHO_BARE_ID}`;

const WEBJS_ECHO_CONTACT = "bbbbbbbb-0000-4000-8000-00000000000b";
const WEBJS_ECHO_CONV = "bbbbbbbb-0000-4000-8000-00000000000c";
const WEBJS_ECHO_QUEUED_MSG = "bbbbbbbb-0000-4000-8000-00000000000d";
const WEBJS_ECHO_ROW = "bbbbbbbb-0000-4000-8000-00000000000e";
const WEBJS_ECHO_PHONE = "+5511900000099";
const WEBJS_ECHO_CHAT_ID = "5511900000099@c.us";
const WEBJS_ECHO_FULL_ID = `true_${WEBJS_ECHO_CHAT_ID}_3EB0WEBJSECHOPROOF`;

let wahaMock: http.Server;
let wahaPort = 0;
const sendTextCalls: Array<{ session: string; chatId: string; text: string }> = [];
const startCalls: string[] = [];
const wahaStatusByName: Record<string, string> = { [WAHA_SESSION_NAME]: "WORKING" };
const STOPPED_SESSION = "bbbbbbbb-0000-4000-8000-000000000006";
const STOPPED_NAME = "watchdog-stopped-session";
// Resposta do /api/sendText por chatId — permite cada teste escolher o shape
// (NOWEB bare vs. WEBJS _serialized) sem tocar no comportamento default dos
// testes já existentes, que caem no fallback NOWEB_ID.
const sendTextResponseByChatId: Record<string, unknown> = {};

function watchdogCfg(): WatchdogConfig {
  return {
    wahaBaseUrl: `http://127.0.0.1:${wahaPort}`,
    wahaApiKey: "test-key",
    intervalMs: 1000,
    redriveMinAgeMs: 0,
    redriveBatchSize: 10,
    redriveSpacingMs: 1,
  };
}

beforeAll(async () => {
  // WAHA-mock: /api/sessions espelha wahaStatusByName; POST /start marca STARTING;
  // /api/sendText devolve o shape NOWEB aninhado (o que quebrava o parse antigo).
  wahaMock = http.createServer((req, res) => {
    const start = req.method === "POST" ? req.url?.match(/^\/api\/sessions\/([^/]+)\/start/) : null;
    if (start) {
      const name = decodeURIComponent(start[1] ?? "");
      startCalls.push(name);
      wahaStatusByName[name] = "STARTING";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "STARTING" }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/sessions")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          Object.entries(wahaStatusByName).map(([name, status]) => ({ name, status })),
        ),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/api/sendText") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body) as (typeof sendTextCalls)[number];
        sendTextCalls.push(parsed);
        res.writeHead(201, { "content-type": "application/json" });
        const custom = sendTextResponseByChatId[parsed.chatId];
        res.end(JSON.stringify(custom ?? { id: { id: NOWEB_ID }, timestamp: 1 }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => wahaMock.listen(0, "127.0.0.1", resolve));
  const addr = wahaMock.address();
  wahaPort = typeof addr === "object" && addr !== null ? addr.port : 0;

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'wd-proof', 'Watchdog Proof', 'Watchdog Proof') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Carlos Prova', '+5511900000002') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  // A DIVERGÊNCIA do incidente real: espelho STARTING, WAHA (mock) WORKING.
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, $3, 'STARTING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG, WAHA_SESSION_NAME],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                           type, direction, status, body, sent_via, sent_at, metadata)
     values ($1, $2, $3, $4, $5, 'text', 'outbound', 'queued', 'resposta presa do agente', 'ai', now(),
             '{"queued_reason":"channel_session_not_working"}')
     on conflict (id) do nothing`,
    [QUEUED_MSG, ORG, CONV, SESSION, CONTACT],
  );
  // redriveQueued varre TODAS as orgs (comportamento de produção). No container
  // efêmero COMPARTILHADO com as outras suítes (ex.: automation-send-whatsapp
  // deixa uma outbound 'ai' queued), o cenário "exatamente 1 preso" precisa
  // garantir que a fila contém só a mensagem DESTE teste — sem isso o redrive
  // conta as mensagens vazadas das vizinhas.
  await pool.query(
    `delete from messages where status = 'queued' and sent_via = 'ai' and organization_id <> $1`,
    [ORG],
  );

});

afterAll(async () => {
  await new Promise<void>((resolve) => wahaMock.close(() => resolve()));
  await pool.end();
});

describe("4A-2 — watchdog reconcilia o espelho e reenvia queued", () => {
  it("reconciliador: espelho STARTING vira WORKING (fonte = WAHA real)", async () => {
    const fixed = await reconcileSessions(pool, watchdogCfg(), log);
    expect(fixed).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      "select status from channel_sessions where id = $1",
      [SESSION],
    );
    expect(rows[0]!.status).toBe("WORKING");
  });

  it("retoma sessão STOPPED — credencial no disco, sem pedir QR", async () => {
    wahaStatusByName[STOPPED_NAME] = "STOPPED";
    await pool.query(
      `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
       values ($1, $2, $3, 'STOPPED', '\\x00'::bytea) on conflict (id) do nothing`,
      [STOPPED_SESSION, ORG, STOPPED_NAME],
    );
    startCalls.length = 0;

    const fixed = await reconcileSessions(pool, watchdogCfg(), log);
    expect(fixed).toBeGreaterThanOrEqual(1);
    expect(startCalls).toEqual([STOPPED_NAME]);

    const { rows } = await pool.query("select status from channel_sessions where id = $1", [
      STOPPED_SESSION,
    ]);
    expect(rows[0]!.status).toBe("STARTING");
  });

  it("redrive: a queued sai sent COM external_id (shape NOWEB parseado)", async () => {
    const redriven = await redriveQueued(pool, watchdogCfg(), log);
    expect(redriven).toBe(1);

    // o WAHA recebeu exatamente 1 sendText, para a sessão certa
    expect(sendTextCalls).toHaveLength(1);
    expect(sendTextCalls[0]).toMatchObject({
      session: WAHA_SESSION_NAME,
      text: "resposta presa do agente",
    });

    const { rows } = await pool.query(
      "select status, external_id, metadata->>'redrive' as redrive from messages where id = $1",
      [QUEUED_MSG],
    );
    expect(rows[0]).toMatchObject({ status: "sent", external_id: NOWEB_ID, redrive: "watchdog" });
  });

  it("idempotência: segundo tick não reenvia (nada mais queued)", async () => {
    const redriven = await redriveQueued(pool, watchdogCfg(), log);
    expect(redriven).toBe(0);
    expect(sendTextCalls).toHaveLength(1); // nenhum sendText novo
  });
});

/**
 * #196 (upstream) — a IA duplicava resposta depois de o WhatsApp reconectar, e
 * no motor WEBJS a mensagem ficava presa em `queued` e era reenviada ao
 * cliente a cada tick. As duas fixtures simulam o webhook do ECO chegando
 * ANTES de o redrive terminar — a corrida real por trás do bug: NOWEB grava o
 * eco com o id COMPOSTO (diferente do bare que o redrive grava), então a
 * frase ficava duas vezes na conversa; WEBJS grava o eco com o MESMO
 * `_serialized` que o reenvio tentaria gravar, e o unique
 * `(organization_id, external_id)` recusava o UPDATE — a recusa caía no catch
 * como erro transiente e a mensagem nunca saía de `queued`.
 */
describe("#196 — eco do reenvio não duplica a frase nem trava em queued", () => {
  beforeAll(async () => {
    await pool.query(
      `insert into contacts (id, organization_id, name, phone_number)
       values ($1, $2, 'Eco NOWEB', $3), ($4, $2, 'Eco WEBJS', $5)
       on conflict (id) do nothing`,
      [NOWEB_ECHO_CONTACT, ORG, NOWEB_ECHO_PHONE, WEBJS_ECHO_CONTACT, WEBJS_ECHO_PHONE],
    );
    await pool.query(
      `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
       values ($1, $2, $3, $4, 'open', false), ($5, $2, $6, $4, 'open', false)
       on conflict (id) do nothing`,
      [NOWEB_ECHO_CONV, ORG, NOWEB_ECHO_CONTACT, SESSION, WEBJS_ECHO_CONV, WEBJS_ECHO_CONTACT],
    );
    await pool.query(
      `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                             type, direction, status, body, sent_via, sent_at, metadata)
       values
         ($1, $2, $3, $4, $5, 'text', 'outbound', 'queued', 'resposta presa — eco noweb', 'ai', now(), '{}'),
         ($6, $2, $7, $4, $8, 'text', 'outbound', 'queued', 'resposta presa — eco webjs', 'ai', now(), '{}')
       on conflict (id) do nothing`,
      [
        NOWEB_ECHO_QUEUED_MSG, ORG, NOWEB_ECHO_CONV, SESSION, NOWEB_ECHO_CONTACT,
        WEBJS_ECHO_QUEUED_MSG, WEBJS_ECHO_CONV, WEBJS_ECHO_CONTACT,
      ],
    );
    // O eco: igual ao que `lib/waha/ingest.ts` grava de verdade (direction
    // inbound, status delivered, sent_via external_device) — já presente
    // ANTES de o redrive rodar.
    await pool.query(
      `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                             external_id, type, direction, status, body, sent_via, sent_at, metadata)
       values
         ($1, $2, $3, $4, $5, $6, 'text', 'inbound', 'delivered', 'resposta presa — eco noweb', 'external_device', now(), '{}'),
         ($7, $2, $8, $4, $9, $10, 'text', 'inbound', 'delivered', 'resposta presa — eco webjs', 'external_device', now(), '{}')
       on conflict (id) do nothing`,
      [
        NOWEB_ECHO_ROW, ORG, NOWEB_ECHO_CONV, SESSION, NOWEB_ECHO_CONTACT, NOWEB_ECHO_COMPOSITE_ID,
        WEBJS_ECHO_ROW, WEBJS_ECHO_CONV, WEBJS_ECHO_CONTACT, WEBJS_ECHO_FULL_ID,
      ],
    );
    sendTextResponseByChatId[NOWEB_ECHO_CHAT_ID] = { id: { id: NOWEB_ECHO_BARE_ID }, timestamp: 1 };
    sendTextResponseByChatId[WEBJS_ECHO_CHAT_ID] = { id: { _serialized: WEBJS_ECHO_FULL_ID }, timestamp: 1 };
  });

  it("reenvia as duas, apaga os dois ecos e resolve o 23505 do WEBJS", async () => {
    const redriven = await redriveQueued(pool, watchdogCfg(), log);
    expect(redriven).toBeGreaterThanOrEqual(2);

    // NOWEB: sai sent com o id BARE (o que o mock devolveu), e o eco —
    // gravado com o id COMPOSTO — foi apagado, sem segunda linha na conversa.
    const { rows: nowebMsg } = await pool.query(
      "select status, external_id from messages where id = $1",
      [NOWEB_ECHO_QUEUED_MSG],
    );
    expect(nowebMsg[0]).toMatchObject({ status: "sent", external_id: NOWEB_ECHO_BARE_ID });
    const { rows: nowebEcho } = await pool.query("select id from messages where id = $1", [
      NOWEB_ECHO_ROW,
    ]);
    expect(nowebEcho).toHaveLength(0);
    const { rows: nowebConv } = await pool.query(
      "select count(*)::int as n from messages where conversation_id = $1 and body = 'resposta presa — eco noweb'",
      [NOWEB_ECHO_CONV],
    );
    expect(nowebConv[0]!.n).toBe(1); // a frase aparece uma vez só, não duas

    // WEBJS: o primeiro UPDATE bateu no unique (o eco já ocupava o id) —
    // ainda assim sai `sent`, o eco é apagado e o id certo é gravado depois.
    const { rows: webjsMsg } = await pool.query(
      "select status, external_id from messages where id = $1",
      [WEBJS_ECHO_QUEUED_MSG],
    );
    expect(webjsMsg[0]).toMatchObject({ status: "sent", external_id: WEBJS_ECHO_FULL_ID });
    const { rows: webjsEcho } = await pool.query("select id from messages where id = $1", [
      WEBJS_ECHO_ROW,
    ]);
    expect(webjsEcho).toHaveLength(0);
  });

  it("idempotência: sem a mensagem presa em queued, o próximo tick não reenvia (o loop do #196)", async () => {
    const before = sendTextCalls.length;
    const redriven = await redriveQueued(pool, watchdogCfg(), log);
    expect(redriven).toBe(0);
    expect(sendTextCalls).toHaveLength(before); // nenhum sendText novo — sem reenvio a cada tick
  });
});
