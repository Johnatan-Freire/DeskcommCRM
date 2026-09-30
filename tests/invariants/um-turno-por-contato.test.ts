/**
 * M · DUAS MENSAGENS QUASE JUNTAS NÃO GERAM RESPOSTAS DE ESCOPOS DIFERENTES.
 *
 * O resolvedor de identidade roda DENTRO do turno, antes da escolha do agente
 * (`resolveConversationTurn`). Se dois turnos do mesmo contato rodassem em paralelo,
 * o primeiro poderia escolher o agente comercial enquanto o segundo movia o card
 * para "Alunos e responsáveis" — e o contato receberia respostas dos dois escopos.
 *
 * O que impede é a fila do agent-engine: um job `running` por contato (lane por
 * `contact_id`, índice `uniq_job_queue_one_running_per_contact`). Este arquivo prova
 * isso contra Postgres real, com o `claimJobs` de produção e dois workers
 * disputando. A última defesa — o card mudar de etapa enquanto o modelo gera, por
 * mão humana — é a releitura do escopo no `beforeSend`
 * (`tests/unit/identidade-escolar-antes-do-agente.test.ts`, J/M).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claimJobs, enqueueJob } from "@/lib/agent-engine/queue/queue";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 6,
});
const ORG = randomUUID();
const CONTATO = randomUUID();
const OUTRO = randomUUID();

beforeAll(async () => {
  await pool.query("insert into organizations(id,display_name,legal_name,slug) values($1,'Lane','Lane',$2)", [ORG, `lane-${ORG.slice(0, 8)}`]);
  for (const id of [CONTATO, OUTRO]) {
    await pool.query("insert into contacts(id,organization_id,display_name,phone_number) values($1,$2,'C',$3)", [
      id, ORG, `+55619${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
    ]);
  }
});
afterAll(async () => {
  await pool.end();
});

describe("M · um turno por contato por vez", () => {
  it("duas mensagens do MESMO contato → dois jobs, dois workers disputando → só UM roda", async () => {
    await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO, payload: { n: 1 } });
    await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO, payload: { n: 2 } });
    await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: OUTRO, payload: { n: 3 } });

    const [a, b] = await Promise.all([
      claimJobs(pool, { workerId: "w1", maxConcurrency: 50 }),
      claimJobs(pool, { workerId: "w2", maxConcurrency: 50 }),
    ]);
    const doContato = [...a, ...b].filter((j) => j.contact_id === CONTATO);
    expect(doContato, "jobs do mesmo contato em execução ao mesmo tempo").toHaveLength(1);
    // Controle: o outro contato NÃO é bloqueado pela lane alheia.
    expect([...a, ...b].filter((j) => j.contact_id === OUTRO)).toHaveLength(1);

    const { rows } = await pool.query<{ n: string }>(
      "select count(*)::text n from job_queue where organization_id=$1 and contact_id=$2 and status='running'",
      [ORG, CONTATO],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("o banco recusa um segundo 'running' do mesmo contato mesmo sem passar pelo claim", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "select id from job_queue where organization_id=$1 and contact_id=$2 and status='pending' limit 1",
      [ORG, CONTATO],
    );
    await expect(pool.query("update job_queue set status='running' where id=$1", [rows[0]!.id])).rejects.toMatchObject({
      code: "23505",
    });
  });
});
