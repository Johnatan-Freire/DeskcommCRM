/**
 * O TRAÇO DO TURNO TEM PRAZO — migration 8007 (decisão do dono: 90 dias).
 *
 * `tests/unit/retencao-todo-piso-tem-dono.test.ts` casa o TEXTO do piso no
 * corpo da função. Aqui a função REAL roda contra linhas REAIS do baseline que
 * o self-hoster aplica, e o que se mede é quem sobrou:
 *   - padrão 90: apaga o de 91 dias, preserva o de 89;
 *   - piso 30: pedir 1 dia não apaga o de 29;
 *   - o lote respeita o limite pedido;
 *   - só `service_role` executa (sessão e anon não alcançam pela REST).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 2,
});

const ORG = randomUUID();

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}

async function traco(idadeDias: number): Promise<string> {
  const id = randomUUID();
  await q(
    `insert into agent_turn_traces (id, organization_id, job_id, status, created_at)
     values ($1::uuid, $2::uuid, $3::uuid, 'completed', now() - make_interval(days => $4::int))`,
    [id, ORG, randomUUID(), idadeDias],
  );
  return id;
}

async function existe(id: string): Promise<boolean> {
  return (await q("select 1 from agent_turn_traces where id = $1", [id])).length === 1;
}

async function expurgar(dias: number | null, limite: number | null): Promise<number> {
  const [r] = await q<{ n: number }>("select public.fn_expurgar_traco_do_turno_vencido($1::int, $2::int) as n", [
    dias,
    limite,
  ]);
  return Number(r?.n ?? 0);
}

beforeAll(async () => {
  await q("insert into organizations (id, slug, legal_name, display_name) values ($1, $2, 'Traço', 'Traço')", [
    ORG,
    `traco-8007-${ORG}`,
  ]);
});
afterAll(async () => {
  await q("delete from agent_turn_traces where organization_id = $1", [ORG]);
  await pool.end();
});

describe("fn_expurgar_traco_do_turno_vencido (SQL real)", () => {
  it("padrão de 90 dias: apaga o de 91, preserva o de 89", async () => {
    const velho = await traco(91);
    const recente = await traco(89);
    await expurgar(null, null);
    expect(await existe(velho)).toBe(false);
    expect(await existe(recente)).toBe(true);
  });

  it("o piso de 30 dias vale para quem chama direto: pedir 1 dia não apaga o de 29", async () => {
    const dentroDoPiso = await traco(29);
    const foraDoPiso = await traco(31);
    await expurgar(1, null);
    expect(await existe(dentroDoPiso)).toBe(true);
    expect(await existe(foraDoPiso)).toBe(false);
  });

  it("o lote respeita o limite pedido e o resto sai na chamada seguinte", async () => {
    const ids = [await traco(200), await traco(201), await traco(202)];
    expect(await expurgar(90, 2)).toBe(2);
    expect(await expurgar(90, 2)).toBe(1);
    for (const id of ids) expect(await existe(id)).toBe(false);
  });

  it("só service_role executa", async () => {
    const [r] = await q<Record<string, boolean>>(
      `select has_function_privilege('anon', 'public.fn_expurgar_traco_do_turno_vencido(int,int)', 'EXECUTE') anon,
              has_function_privilege('authenticated', 'public.fn_expurgar_traco_do_turno_vencido(int,int)', 'EXECUTE') sessao,
              has_function_privilege('service_role', 'public.fn_expurgar_traco_do_turno_vencido(int,int)', 'EXECUTE') servico`,
    );
    expect(r).toEqual({ anon: false, sessao: false, servico: true });
  });
});
