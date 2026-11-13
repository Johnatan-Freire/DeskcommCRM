/**
 * ANONIMIZAR ALCANÇA AS FICHAS FUNDIDAS (migration 8005), contra Postgres real
 * com o baseline que o self-hoster aplica.
 *
 * `fn_mesclar_contatos` move conversas e negócios para o principal, mas a ficha
 * absorvida continua existindo — com nome, telefone e e-mail de antes — e só
 * aponta para o principal por `is_merged_into`. A cascata da LGPD anonimizava só
 * o titular: o pedido de apagamento era atendido e a pessoa seguia no banco.
 *
 * Provas:
 *   - a ficha fundida é anonimizada junto, com a própria linha de auditoria;
 *   - fusão de fusão (A → B → C) é alcançada inteira;
 *   - ficha de OUTRA organização que aponte para o titular não é tocada;
 *   - titular já anonimizado ainda leva a ficha que ficou para trás;
 *   - a sessão não grava fusão nem anonimização direto (gatilho 42501).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});

const ORG = "f5a80000-0000-4000-8000-000000000001";
const VIZINHA = "f5a80000-0000-4000-8000-0000000000f0";
let seq = 0;
const novoId = () => `f5a80000-0001-4000-8000-${String(++seq).padStart(12, "0")}`;

async function contato(
  campos: { org?: string; nome: string; telefone: string; email?: string; anonimizado?: boolean },
): Promise<string> {
  const id = novoId();
  await pool.query(
    `insert into contacts (id, organization_id, name, email, phone_number, is_anonymized, anonymized_at)
     values ($1, $2, $3, $4, $5, $6, case when $6 then now() else null end)`,
    [id, campos.org ?? ORG, campos.nome, campos.email ?? null, campos.telefone, campos.anonimizado ?? false],
  );
  return id;
}
async function mesclar(principal: string, secundarios: string[]) {
  await pool.query("select public.fn_mesclar_contatos($1, $2, $3)", [ORG, principal, secundarios]);
}
async function anonimizar(org: string, id: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ r: Record<string, unknown> }>(
    "select public.fn_lgpd_cascade_redact_contact($1, $2, gen_random_uuid()) r",
    [org, id],
  );
  return rows[0]!.r;
}
async function ficha(id: string) {
  const { rows } = await pool.query<{
    is_anonymized: boolean;
    name: string | null;
    email: string | null;
    phone_number: string | null;
  }>("select is_anonymized, name, email, phone_number from contacts where id = $1", [id]);
  return rows[0]!;
}
async function auditorias(id: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "select count(*)::text n from api_audit_log where action = 'lgpd.redact_executed' and resource_id = $1",
    [id],
  );
  return Number(rows[0]!.n);
}
/** O que sobrou da pessoa na ficha: nenhum dos dados originais. */
async function semDadosDe(id: string, original: { nome: string; telefone: string; email?: string }) {
  const f = await ficha(id);
  expect(f.is_anonymized).toBe(true);
  expect(f.name).not.toBe(original.nome);
  expect(f.phone_number).not.toBe(original.telefone);
  if (original.email) expect(f.email).not.toBe(original.email);
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-f5a8', 'Fusão LTDA', 'Fusão'), ($2, 'org-f5a8-vizinha', 'Vizinha LTDA', 'Vizinha')
     on conflict (id) do nothing`,
    [ORG, VIZINHA],
  );
});
afterAll(async () => {
  await pool.end();
});

describe("a cascata alcança as fichas fundidas no titular", () => {
  it("ficha fundida é anonimizada junto, com a própria linha de auditoria", async () => {
    const principal = await contato({ nome: "Maria Souza", telefone: "+5561999990001" });
    const dadosSec = { nome: "Maria S.", telefone: "+5561999990002", email: "maria.s@exemplo.test" };
    const secundaria = await contato(dadosSec);
    await mesclar(principal, [secundaria]);
    expect((await ficha(secundaria)).is_anonymized).toBe(false); // a fusão sozinha não apaga nada

    const r = await anonimizar(ORG, principal);
    expect(r.already_anonymized).toBe(false);
    expect((r.counts as Record<string, number>).fichas_fundidas).toBe(1);
    expect((r.fichas_fundidas as Array<{ contact_id: string }>).map((x) => x.contact_id)).toEqual([secundaria]);

    await semDadosDe(secundaria, dadosSec);
    expect(await auditorias(principal)).toBe(1);
    expect(await auditorias(secundaria)).toBe(1);
  });

  it("fusão de fusão (A → B → C) é alcançada inteira", async () => {
    const c = await contato({ nome: "Carlos Lima", telefone: "+5561999990011" });
    const b = await contato({ nome: "Carlos L.", telefone: "+5561999990012" });
    const dadosA = { nome: "Carlinhos", telefone: "+5561999990013" };
    const a = await contato(dadosA);
    await mesclar(b, [a]);
    await mesclar(c, [b]);

    await anonimizar(ORG, c);
    await semDadosDe(b, { nome: "Carlos L.", telefone: "+5561999990012" });
    await semDadosDe(a, dadosA);
  });

  it("ficha de OUTRA organização apontando para o titular não é tocada", async () => {
    const titular = await contato({ nome: "Ana Prado", telefone: "+5561999990021" });
    const alheia = await contato({ org: VIZINHA, nome: "Ana da vizinha", telefone: "+5561999990022" });
    // Estado que nenhum caminho do produto cria, forçado pelo dono do banco.
    await pool.query("update contacts set is_merged_into = $2, merged_at = now() where id = $1", [alheia, titular]);

    await anonimizar(ORG, titular);
    expect(await ficha(alheia)).toMatchObject({ is_anonymized: false, name: "Ana da vizinha" });
  });

  it("titular já anonimizado ainda leva a ficha que ficou para trás; repetir não acha ninguém", async () => {
    const titular = await contato({ nome: "Bruno Reis", telefone: "+5561999990031" });
    await anonimizar(ORG, titular);
    // Ficha fundida que ficou para trás (anonimização feita antes desta versão).
    const dados = { nome: "Bruno R.", telefone: "+5561999990032" };
    const atrasada = await contato(dados);
    await pool.query("update contacts set is_merged_into = $2, merged_at = now() where id = $1", [atrasada, titular]);

    const r = await anonimizar(ORG, titular);
    expect(r.already_anonymized).toBe(true);
    await semDadosDe(atrasada, dados);

    const de_novo = await anonimizar(ORG, titular);
    expect(de_novo.fichas_fundidas).toEqual([]);
    expect(await auditorias(atrasada)).toBe(1);
  });
});

describe("a sessão não grava fusão nem anonimização", () => {
  async function comoSessao<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      return await fn(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  it("criar ficha já anonimizada ou já fundida pela sessão é recusado (42501)", async () => {
    for (const extra of ["is_anonymized", "merged_at"]) {
      const valor = extra === "is_anonymized" ? "true" : "now()";
      await expect(
        comoSessao((c) =>
          c.query(`insert into contacts (organization_id, name, ${extra}) values ($1, 'x', ${valor})`, [ORG]),
        ),
      ).rejects.toMatchObject({
        // A RLS também devolve 42501: a MENSAGEM é o que prova que foi o gatilho.
        code: "42501",
        message: "contacts_fusao_e_anonimizacao_so_pelo_servidor",
      });
    }
  });

  it("o gatilho de UPDATE vigia exatamente as quatro colunas de fusão e anonimização", async () => {
    const { rows } = await pool.query<{ def: string }>(
      `select pg_get_triggerdef(t.oid) def from pg_trigger t
        where t.tgrelid = 'public.contacts'::regclass
          and t.tgname = 'trg_contacts_fusao_e_anonimizacao_so_pelo_servidor'`,
    );
    const def = rows[0]!.def;
    for (const col of ["is_merged_into", "merged_at", "is_anonymized", "anonymized_at"]) {
      expect(def).toContain(`old.${col} IS DISTINCT FROM new.${col}`);
    }
  });

  it("a fusão pelo servidor continua funcionando com o gatilho no lugar", async () => {
    const p = await contato({ nome: "Davi Melo", telefone: "+5561999990041" });
    const s = await contato({ nome: "Davi M.", telefone: "+5561999990042" });
    await mesclar(p, [s]);
    const { rows } = await pool.query<{ is_merged_into: string | null }>(
      "select is_merged_into from contacts where id = $1",
      [s],
    );
    expect(rows[0]!.is_merged_into).toBe(p);
  });
});
