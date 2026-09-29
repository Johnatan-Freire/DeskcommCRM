import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lerIaSilenciada } from "@/lib/agent-engine/guardrails/before-send";
import { isLeadInHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { criarOrigemDeFollowup } from "./followup-service-origin";
import { GOV_AGENT_A, seedGov } from "./gov-helpers";

/**
 * A releitura do silêncio no ENVIO (`lerIaSilenciada`) fala a mesma língua que a
 * leitura do INÍCIO do turno (`isLeadInHandoff`) — no banco real, com os valores
 * que o Postgres de fato grava ('infinity', silêncio vencido) e com as duas
 * atribuições que parecem iguais e não são: "Assumir" cala, round robin não.
 */
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
beforeAll(() => seedGov());
afterAll(() => pool.end());

async function cenario() {
  const org = randomUUID();
  const contact = randomUUID();
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Escola','Escola')",
    [org],
  );
  await pool.query(
    "insert into user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'agent',now())",
    [org, GOV_AGENT_A],
  );
  await pool.query(
    "insert into contacts(id,organization_id,name,display_name) values($1,$2,'Aluno','Aluno')",
    [contact, org],
  );
  const { conversation_id } = await criarOrigemDeFollowup(pool, org, contact);
  const silencio = (v: string | null) =>
    pool.query("update conversations set bot_silenced_until=$2::timestamptz where id=$1", [conversation_id, v]);
  const ambas = async () => ({
    envio: await lerIaSilenciada(pool, org, contact),
    inicio: await isLeadInHandoff(pool, org, contact),
  });
  return { org, contact, conversation_id, silencio, ambas };
}

describe("lerIaSilenciada × isLeadInHandoff", () => {
  it("sem silêncio: as duas dizem que a IA pode falar", async () => {
    const c = await cenario();
    expect(await c.ambas()).toEqual({ envio: false, inicio: false });
  });

  it("'infinity' (Assumir, handoff) cala nas duas", async () => {
    const c = await cenario();
    await c.silencio("infinity");
    expect(await c.ambas()).toEqual({ envio: true, inicio: true });
  });

  it("silêncio deslizante no futuro (resposta manual) cala; vencido não", async () => {
    const c = await cenario();
    await c.silencio(new Date(Date.now() + 5 * 60_000).toISOString());
    expect(await c.ambas()).toEqual({ envio: true, inicio: true });
    await c.silencio(new Date(Date.now() - 60_000).toISOString());
    expect(await c.ambas()).toEqual({ envio: false, inicio: false });
  });

  it("Assumir (fn_conversation_assign 'claim') cala", async () => {
    const c = await cenario();
    await pool.query("select * from fn_conversation_assign($1,$2,$3,'claim')", [
      c.org,
      c.conversation_id,
      GOV_AGENT_A,
    ]);
    expect((await c.ambas()).envio).toBe(true);
  });

  it("round robin ('routing') atribui dono SEM calar — o envio segue liberado", async () => {
    const c = await cenario();
    await pool.query("select * from fn_conversation_assign($1,$2,$3,'routing')", [
      c.org,
      c.conversation_id,
      GOV_AGENT_A,
    ]);
    const dono = await pool.query("select assigned_to_user_id from conversations where id=$1", [
      c.conversation_id,
    ]);
    expect(dono.rows[0].assigned_to_user_id).toBe(GOV_AGENT_A);
    expect(await c.ambas()).toEqual({ envio: false, inicio: false });
  });

  it("force_human fica fora desta leitura (é do readStopFlags) — só o início o soma", async () => {
    const c = await cenario();
    await pool.query("update contacts set force_human=true where id=$1", [c.contact]);
    expect(await c.ambas()).toEqual({ envio: false, inicio: true });
  });
});
