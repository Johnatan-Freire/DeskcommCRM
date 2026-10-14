import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { createPgAdminClient } from "@/lib/followup/turn-bridge";

import { isolarFixtureDeFollowup } from "./followup-isolamento";

/**
 * Migration 0657 — PAUSA GLOBAL DE FOLLOW-UPS. Pausar CONGELA, não pula:
 *
 *  1. o claim não reivindica inscrição de organização pausada (e continua
 *     reivindicando a das outras);
 *  2. inscrição criada durante a pausa nasce `cancelled` com o motivo, por
 *     qualquer caminho de inscrição (o gatilho é na tabela);
 *  3. as duas funções de corte respondem `followups_pausados` antes de tudo;
 *  4. retomar devolve o claim às inscrições vivas, no mesmo nó.
 *
 * Quem chama o claim é o adapter de PRODUÇÃO (`createPgAdminClient`).
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});
const db = createPgAdminClient(pool);

const ORG_PAUSADA = "f0000657-0000-4000-8000-00000000fa01";
const ORG_LIVRE = "f0000657-0000-4000-8000-00000000fa02";

const GRAFO_MINIMO = JSON.stringify({
  nodes: [
    { id: "t1", type: "trigger", label: "i", position: { x: 0, y: 0 }, config: {} },
    { id: "e1", type: "end", label: "f", position: { x: 0, y: 0 }, config: { outcome: "converted" } },
  ],
  edges: [{ id: "a", source: "t1", target: "e1", priority: 0, condition: { type: "always" } }],
});

async function semearOrg(org: string, nome: string) {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1, $2, $3, $3)
     on conflict (id) do update set followups_pausados_em = null, followups_pausados_por = null`,
    [org, `pausa-global-${nome}`, nome],
  );
  const { rows: v } = await pool.query<{ id: string }>(
    `insert into followup_flow_versions (organization_id, graph) values ($1, $2) returning id`,
    [org, GRAFO_MINIMO],
  );
  const { rows: p } = await pool.query<{ id: string }>(
    `insert into followup_flow_pointers (organization_id, name, status, active_version_id, trigger_config)
     values ($1, $2, 'active', $3, '{"kind":"manual"}'::jsonb) returning id`,
    [org, `Fluxo ${nome} ${Date.now()}-${Math.random()}`, v[0]!.id],
  );
  return { pointerId: p[0]!.id, versionId: v[0]!.id };
}

async function inscrever(org: string, ids: { pointerId: string; versionId: string }): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `with c as (insert into contacts (organization_id, display_name) values ($1, 'Lead pausa') returning id)
     insert into followup_enrollments
       (organization_id, pointer_id, version_id, contact_id, current_node_id, status, next_eval_at)
     select $1, $2, $3, c.id, 't1', 'active', now() - interval '5 minutes' from c
     returning id`,
    [org, ids.pointerId, ids.versionId],
  );
  return rows[0]!.id;
}

async function pausar(org: string, pausado: boolean) {
  await pool.query(`update organizations set followups_pausados_em = $2 where id = $1`, [
    org,
    pausado ? new Date().toISOString() : null,
  ]);
}

beforeEach(async () => {
  await isolarFixtureDeFollowup(pool);
});

afterAll(async () => {
  await isolarFixtureDeFollowup(pool);
  await pool.query(`update organizations set followups_pausados_em = null where id in ($1, $2)`, [ORG_PAUSADA, ORG_LIVRE]);
  await pool.end();
});

describe("0657 · pausa global de follow-ups", () => {
  it("o claim não reivindica a organização pausada — e segue reivindicando as outras", async () => {
    const pausada = await semearOrg(ORG_PAUSADA, "pausada");
    const livre = await semearOrg(ORG_LIVRE, "livre");
    const daPausada = await inscrever(ORG_PAUSADA, pausada);
    const daLivre = await inscrever(ORG_LIVRE, livre);
    await pausar(ORG_PAUSADA, true);

    const reclamados = (await db.claimDueEnrollments(20, 120)).map((e) => e.id);
    expect(reclamados).toContain(daLivre);
    expect(reclamados).not.toContain(daPausada);

    // A inscrição pausada CONTINUA viva e no mesmo nó: pausar não é cancelar.
    const { rows } = await pool.query(`select status, current_node_id from followup_enrollments where id = $1`, [daPausada]);
    expect(rows[0]).toEqual({ status: "active", current_node_id: "t1" });
  });

  it("retomar devolve o claim à inscrição que estava parada", async () => {
    const pausada = await semearOrg(ORG_PAUSADA, "pausada");
    const id = await inscrever(ORG_PAUSADA, pausada);
    await pausar(ORG_PAUSADA, true);
    expect((await db.claimDueEnrollments(20, 120)).map((e) => e.id)).not.toContain(id);

    await pausar(ORG_PAUSADA, false);
    expect((await db.claimDueEnrollments(20, 120)).map((e) => e.id)).toContain(id);
  });

  it("inscrição criada DURANTE a pausa nasce cancelada, com o motivo — e não ocupa a vaga do contato", async () => {
    const pausada = await semearOrg(ORG_PAUSADA, "pausada");
    await pausar(ORG_PAUSADA, true);
    const id = await inscrever(ORG_PAUSADA, pausada);

    const { rows } = await pool.query(
      `select status, cancel_reason, next_eval_at, completed_at is not null as encerrada
         from followup_enrollments where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ status: "cancelled", cancel_reason: "followups_pausados", next_eval_at: null, encerrada: true });
  });

  it("inscrição criada sem pausa nasce viva (o gatilho não muda o caminho normal)", async () => {
    const livre = await semearOrg(ORG_LIVRE, "livre");
    const id = await inscrever(ORG_LIVRE, livre);
    const { rows } = await pool.query(`select status, cancel_reason from followup_enrollments where id = $1`, [id]);
    expect(rows[0]).toEqual({ status: "active", cancel_reason: null });
  });

  it("as funções de corte respondem 'followups_pausados' antes de qualquer outra regra", async () => {
    const pausada = await semearOrg(ORG_PAUSADA, "pausada");
    const id = await inscrever(ORG_PAUSADA, pausada);
    await pausar(ORG_PAUSADA, true);

    const { rows: envio } = await pool.query<{ m: string }>(`select public.fn_followup_pode_enviar($1, $2) as m`, [ORG_PAUSADA, id]);
    expect(envio[0]!.m).toBe("followups_pausados");

    // Conversa que nem existe: a pausa vence até o "conversa_desconhecida".
    const { rows: silencio } = await pool.query<{ m: string }>(
      `select public.fn_silencio_pode_reengajar($1, gen_random_uuid(), true) as m`,
      [ORG_PAUSADA],
    );
    expect(silencio[0]!.m).toBe("followups_pausados");

    await pausar(ORG_PAUSADA, false);
    const { rows: depois } = await pool.query<{ m: string }>(`select public.fn_followup_pode_enviar($1, $2) as m`, [ORG_PAUSADA, id]);
    expect(depois[0]!.m).not.toBe("followups_pausados");
  });

  it("a função do gatilho não é chamável pela REST (anon/authenticated/service_role sem EXECUTE)", async () => {
    const { rows } = await pool.query<{ papel: string; pode: boolean }>(
      `select r as papel, has_function_privilege(r, 'public.fn_followup_inscricao_respeita_pausa()', 'EXECUTE') as pode
         from unnest(array['anon','authenticated','service_role']) r`,
    );
    expect(rows.filter((r) => r.pode)).toEqual([]);
  });
});
