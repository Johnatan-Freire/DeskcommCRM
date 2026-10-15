import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { registrarPreMatricula, TEXTO_DO_CONSENTIMENTO_V1 } from "@/lib/pre-matricula/registrar";

import { GOV_AGENT_A, GOV_ORG, GOV_VIEWER, countAs, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/**
 * Migration 0659 — PRÉ-MATRÍCULA. Medido contra o Postgres de verdade, pela MESMA
 * função que a tool do agente usa (`registrarPreMatricula`):
 *
 *  - grava com consentimento (instante + texto) e liga ao lead aberto do contato;
 *  - é idempotente: a segunda confirmação do mesmo curso devolve a que existe;
 *  - membro lê, agent+ atualiza, ninguém insere nem apaga pela REST;
 *  - anonimizar o contato redige nome, e-mail, telefone e anotação, e preserva o
 *    que é do negócio (curso, turno, status, datas).
 */

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`, max: 8 });

const CONTATO = randomUUID();
const DADOS = {
  nome_completo: "Joana Ficticia Souza",
  email: "joana@exemplo.invalid",
  curso: "Excel Avançado",
  turno: "noite" as const,
  consentimento: true as const,
  telefone: "5561999990000",
};

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name, phone_number)
    values ('${CONTATO}', '${GOV_ORG}', 'Joana', '+5561999990000');
  `);
});

afterAll(async () => {
  sql(`delete from public.pre_matriculas where contact_id = '${CONTATO}';`);
  await pool.end();
});

describe("0659 · registrar", () => {
  let primeira = "";

  it("grava com o consentimento e o texto aceito", async () => {
    const r = await registrarPreMatricula(pool, { organizationId: GOV_ORG, contactId: CONTATO, conversationId: null, agentId: null }, DADOS);
    expect(r).toMatchObject({ ok: true, status: "registrada" });
    if (!r.ok) return;
    primeira = r.id;
    const out = sql(`
      select status || '|' || turno || '|' || (consentimento_em is not null)::text || '|' || (consentimento_texto = '${TEXTO_DO_CONSENTIMENTO_V1.replace(/'/g, "''")}')::text
        from public.pre_matriculas where id = '${r.id}';`);
    expect(lastLine(out)).toBe("nova|noite|true|true");
  });

  it("⭐ confirmar de novo o mesmo curso não cria outro pedido (idempotente)", async () => {
    const r = await registrarPreMatricula(
      pool,
      { organizationId: GOV_ORG, contactId: CONTATO, conversationId: null, agentId: null },
      { ...DADOS, curso: "  excel avançado " },
    );
    expect(r).toEqual({ ok: true, status: "ja_existia", id: primeira });
    expect(lastLine(sql(`select count(*) from public.pre_matriculas where contact_id = '${CONTATO}';`))).toBe("1");
  });

  it("outro curso é outro pedido; o mesmo curso concluído libera um novo", async () => {
    const outro = await registrarPreMatricula(
      pool,
      { organizationId: GOV_ORG, contactId: CONTATO, conversationId: null, agentId: null },
      { ...DADOS, curso: "Informática Básica" },
    );
    expect(outro).toMatchObject({ ok: true, status: "registrada" });
    sql(`update public.pre_matriculas set status = 'desistiu' where id = '${primeira}';`);
    const denovo = await registrarPreMatricula(pool, { organizationId: GOV_ORG, contactId: CONTATO, conversationId: null, agentId: null }, DADOS);
    expect(denovo).toMatchObject({ ok: true, status: "registrada" });
  });
});

describe("0659 · concorrência", () => {
  it("⭐ seis confirmações SIMULTÂNEAS do mesmo curso: um pedido só, e nenhuma resposta de falha", async () => {
    const contato = randomUUID();
    sql(`insert into public.contacts (id, organization_id, display_name, phone_number)
         values ('${contato}', '${GOV_ORG}', 'Concorrente', '+5561988887777');`);
    const ctx = { organizationId: GOV_ORG, contactId: contato, conversationId: null, agentId: null };
    const resultados = await Promise.all(
      Array.from({ length: 6 }, () => registrarPreMatricula(pool, ctx, { ...DADOS, curso: "Programação" })),
    );
    expect(resultados.every((r) => r.ok)).toBe(true);
    const status = resultados.map((r) => (r.ok ? r.status : "falhou")).sort();
    expect(status).toEqual(["ja_existia", "ja_existia", "ja_existia", "ja_existia", "ja_existia", "registrada"]);
    const ids = new Set(resultados.map((r) => (r.ok ? r.id : "")));
    expect(ids.size).toBe(1);
    expect(lastLine(sql(`select count(*) from public.pre_matriculas where contact_id = '${contato}';`))).toBe("1");
  });
});

describe("0659 · corrida determinística", () => {
  it("⭐ a confirmação que espera outra em voo devolve a que existe (não 'não consegui registrar')", async () => {
    const contato = randomUUID();
    sql(`insert into public.contacts (id, organization_id, display_name, phone_number)
         values ('${contato}', '${GOV_ORG}', 'Em voo', '+5561977776666');`);
    const segura = await pool.connect();
    try {
      // A: insere e SEGURA o commit — a linha existe, mas ainda não está visível.
      await segura.query("begin");
      await segura.query(
        `insert into public.pre_matriculas (organization_id, contact_id, nome_completo, email, telefone, curso, turno, consentimento_em, consentimento_texto)
         values ($1, $2, 'Em Voo Teste', 'voo@exemplo.invalid', '5561977776666', 'Robótica', 'tarde', now(), 'x')`,
        [GOV_ORG, contato],
      );
      // B: a tool chega no meio — o ON CONFLICT espera A terminar.
      const emEspera = registrarPreMatricula(
        pool,
        { organizationId: GOV_ORG, contactId: contato, conversationId: null, agentId: null },
        { ...DADOS, curso: "Robótica" },
      );
      await new Promise((r) => setTimeout(r, 300));
      await segura.query("commit");
      const r = await emEspera;
      expect(r).toMatchObject({ ok: true, status: "ja_existia" });
    } finally {
      segura.release();
    }
  });
});

describe("0659 · acesso", () => {
  it("membro lê; quem não é membro não lê nada", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.pre_matriculas where contact_id = '${CONTATO}';`)).toBeGreaterThan(0);
    expect(countAs(randomUUID(), `select count(*) from public.pre_matriculas;`)).toBe(0);
  });

  it("agent atualiza o status; viewer não", () => {
    expect(writeCountAs(GOV_VIEWER, `update public.pre_matriculas set observacao = 'x' where contact_id = '${CONTATO}'`)).toBe(0);
    expect(writeCountAs(GOV_AGENT_A, `update public.pre_matriculas set observacao = 'ligar à tarde' where contact_id = '${CONTATO}'`)).toBeGreaterThan(0);
  });

  it("ninguém insere nem apaga pela REST", () => {
    const out = sql(`
      select string_agg(r || '=' || (has_table_privilege(r, 'public.pre_matriculas', 'INSERT')
                                   or has_table_privilege(r, 'public.pre_matriculas', 'DELETE'))::text, ',' order by r)
        from unnest(array['anon','authenticated']) r;`);
    expect(lastLine(out)).toBe("anon=false,authenticated=false");
    const sr = sql(`select has_table_privilege('service_role', 'public.pre_matriculas', 'DELETE')::text;`);
    expect(lastLine(sr)).toBe("false");
  });
});

describe("0659 · LGPD", () => {
  it("⭐ anonimizar o contato redige o que é da pessoa e preserva o que é do negócio", () => {
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${CONTATO}';`);
    const out = sql(`
      select string_agg(distinct nome_completo || '|' || email || '|' || telefone || '|' || coalesce(observacao, '-'), ',')
        from public.pre_matriculas where contact_id = '${CONTATO}';`);
    expect(lastLine(out)).toBe("Cliente Anonimizado|anonimizado@anonimizado.invalid|anonimizado|-");
    const negocio = sql(`select string_agg(distinct curso, ',' order by curso) from public.pre_matriculas where contact_id = '${CONTATO}';`);
    expect(lastLine(negocio)).toBe("Excel Avançado,Informática Básica");
  });
});
