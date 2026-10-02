/**
 * TABELA NOVA DE ORGANIZAÇÃO COM O `ensure_rls` DO SUPABASE — nasce com o
 * isolamento, e não bloqueada.
 *
 * ─── O defeito (medido no cutover para o projeto de Estocolmo, 2026-10-02) ───
 *
 * Projetos Supabase recentes têm o event trigger `ensure_rls`
 * (`public.rls_auto_enable`), que LIGA a RLS de toda tabela criada em `public`
 * no próprio CREATE TABLE. A régua de `fn_proteger_tabelas_de_organizacao` era
 * "tabela de organização com RLS DESLIGADA" — o sinal de "ninguém pensou na
 * proteção desta tabela". Com o trigger esse sinal some: a tabela chega à
 * varredura com RLS ligada, a varredura a pula, e ela fica com RLS e SEM a
 * policy de isolamento — negada para todo usuário do CRM. No projeto de
 * Estocolmo 33 tabelas nasceram assim e foram corrigidas à mão.
 *
 * ─── A régua nova, e por que ela não abre o que é fechado de propósito ───────
 *
 * Uma função NOVA (`fn_proteger_tabelas_sob_ensure_rls`, só no último bloco do
 * baseline) pega a tabela com RLS ligada, NENHUMA policy PERMISSIVA e algum
 * privilégio de `authenticated`. A régua da 0325 não muda. As duas condições juntas
 * separam os três casos que existem hoje (medidos nos dois projetos reais):
 *   - server-only (17 tabelas): sem privilégio para `authenticated` → intocada;
 *   - policy própria por papel (57): tem policy permissiva → intocada;
 *   - nova sem proteção: privilégio padrão e nada permissivo → recebe o isolamento.
 * "Permissiva", e não "qualquer policy": as travas do suporte (0274) criam
 * policies RESTRITIVAS, que sozinhas negam tudo — contar policies em geral foi o
 * erro que, no cutover, primeiro escolheu as 17 tabelas erradas.
 *
 * O que este arquivo cobra: o defeito existe (o trigger liga a RLS), a cura
 * acontece, os casos que não devem mudar não mudam, a cura é idempotente, e uma
 * instalação inteira num projeto recente chega ao MESMO conjunto de RLS,
 * policies e grants do molde comum.
 */
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const container = process.env.TEST_DB_CONTAINER;
const moldeComum = process.env.TEST_DB_TEMPLATE;
const moldeRecente = process.env.TEST_DB_TEMPLATE_SUPABASE_RECENTE;
if (!container || !moldeComum || !moldeRecente) {
  throw new Error(
    "TEST_DB_CONTAINER/TEST_DB_TEMPLATE/TEST_DB_TEMPLATE_SUPABASE_RECENTE ausentes — rode via `pnpm test:db`",
  );
}

function psqlEm(db: string, script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", container as string, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG_1 = "eeeeeeee-0000-4000-8000-000000000001";
const ORG_2 = "eeeeeeee-0000-4000-8000-000000000002";
const USER_1 = "eeeeeeee-1111-4000-8000-000000000001";
const USER_2 = "eeeeeeee-1111-4000-8000-000000000002";

/** Event trigger idêntico ao do Supabase, num schema próprio do teste. */
const ENSURE_RLS = `
create schema if not exists teste_ensure_rls;
create or replace function teste_ensure_rls.rls_auto_enable() returns event_trigger
language plpgsql security definer set search_path to 'pg_catalog' as $function$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then null;
      end;
    end if;
  end loop;
end $function$;
drop event trigger if exists ensure_rls_teste;
create event trigger ensure_rls_teste on ddl_command_end
  when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
  execute function teste_ensure_rls.rls_auto_enable();
`;

const politicas = (tabela: string) =>
  sql(
    `select coalesce(string_agg(polname || ':' || case when polpermissive then 'P' else 'R' end || ':' || polcmd::text, ',' order by polname), '')
       from pg_policy where polrelid = 'public.${tabela}'::regclass;`,
  );
const rlsLigada = (tabela: string) => sql(`select relrowsecurity from pg_class where oid = 'public.${tabela}'::regclass;`) === "t";
const priv = (papel: string, tabela: string, p: string) =>
  sql(`select has_table_privilege('${papel}', 'public.${tabela}', '${p}');`) === "t";
const proteger = () => sql(`select public.fn_proteger_tabelas_sob_ensure_rls();`);

function tabelaDeOrganizacao(nome: string, depois = ""): void {
  sql(`
    create table public.${nome} (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      valor text
    );
    ${depois}
  `);
}

beforeAll(() => {
  sql(ENSURE_RLS);
  sql(`
    insert into public.organizations (id, display_name, legal_name, slug) values
      ('${ORG_1}', 'Org RLS 1', 'Org RLS 1', 'org-rls-1'), ('${ORG_2}', 'Org RLS 2', 'Org RLS 2', 'org-rls-2')
      on conflict (id) do nothing;
    insert into auth.users (id, email) values ('${USER_1}', 'rls1@t.invalid'), ('${USER_2}', 'rls2@t.invalid') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER_1}', '${ORG_1}', 'agent', now()), ('${USER_2}', '${ORG_2}', 'agent', now());
  `);
});

afterAll(() => {
  sql(`drop event trigger if exists ensure_rls_teste;`);
});

describe("com o ensure_rls do Supabase", () => {
  it("o defeito existe: a tabela nova nasce com RLS LIGADA e sem nenhuma policy (antes da varredura)", () => {
    tabelaDeOrganizacao("sonda_rls_nova");
    expect(rlsLigada("sonda_rls_nova")).toBe(true);
    expect(politicas("sonda_rls_nova")).toBe("");
  });

  it("A — tabela nova de organização recebe a policy de isolamento, e o isolamento FUNCIONA", () => {
    proteger();
    expect(rlsLigada("sonda_rls_nova")).toBe(true);
    expect(politicas("sonda_rls_nova")).toContain("tenant_isolation_sonda_rls_nova_all:P:*");
    // G — o anon sai; o authenticated continua com acesso (a RLS é quem filtra)
    expect(priv("anon", "sonda_rls_nova", "select")).toBe(false);
    expect(priv("authenticated", "sonda_rls_nova", "select")).toBe(true);
    sql(`insert into public.sonda_rls_nova (organization_id, valor) values ('${ORG_1}','da 1'),('${ORG_1}','da 1b'),('${ORG_2}','da 2');`);
    const contaComo = (u: string) =>
      sql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true);
           select count(*) from public.sonda_rls_nova; rollback;`).split("\n").filter((l) => /^\d+$/.test(l)).pop();
    expect(contaComo(USER_1)).toBe("2");
    expect(contaComo(USER_2)).toBe("1");
  });

  it("B — server-only (sem privilégio de authenticated) continua SEM policy", () => {
    tabelaDeOrganizacao("sonda_rls_server_only", "revoke all on public.sonda_rls_server_only from anon, authenticated;");
    proteger();
    expect(rlsLigada("sonda_rls_server_only")).toBe(true);
    expect(politicas("sonda_rls_server_only")).toBe("");
  });

  it("B — tabela com policy PRÓPRIA por papel não ganha a policy ampla por cima", () => {
    tabelaDeOrganizacao(
      "sonda_rls_por_papel",
      `create policy sonda_por_papel_select on public.sonda_rls_por_papel for select
         using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));`,
    );
    proteger();
    expect(politicas("sonda_rls_por_papel")).toBe("sonda_por_papel_select:P:r");
  });

  it("B — tabela só com as travas RESTRITIVAS do suporte (o caso das 33 do cutover) recebe o isolamento", () => {
    tabelaDeOrganizacao("sonda_rls_so_travas");
    sql(`select public.fn_aplicar_travas_de_suporte();`);
    expect(politicas("sonda_rls_so_travas")).not.toContain(":P:");
    proteger();
    expect(politicas("sonda_rls_so_travas")).toContain("tenant_isolation_sonda_rls_so_travas_all:P:*");
  });

  it("B — tabela de sistema (sem organization_id) não ganha policy", () => {
    sql(`create table public.sonda_rls_sistema (id serial primary key, chave text);`);
    proteger();
    expect(politicas("sonda_rls_sistema")).toBe("");
  });

  it("C — rodar a varredura de novo não duplica nem muda nada", () => {
    const antes = sql(`select string_agg(c.relname || '=' || p.polname, ',' order by 1) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'sonda_rls_%';`);
    proteger();
    proteger();
    const depois = sql(`select string_agg(c.relname || '=' || p.polname, ',' order by 1) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'sonda_rls_%';`);
    expect(depois).toBe(antes);
    expect(sql(`select count(*) from pg_policy where polname = 'tenant_isolation_sonda_rls_nova_all';`)).toBe("1");
  });

  it("A (módulo) — a provisionadora mantém o contrato da 0325; quem cura a tabela do módulo é o fim do baseline", () => {
    tabelaDeOrganizacao("sonda_rls_modulo");
    sql(`select public.fn_proteger_modulo_provisionado();`);
    // Contrato da 0325, vigiado em provisionadora-de-modulo.test.ts: RLS ligada = "decidiu" — não mexe.
    expect(politicas("sonda_rls_modulo")).not.toContain("tenant_isolation_sonda_rls_modulo_all");
    proteger(); // o último bloco do baseline, na próxima aplicação (update.sh / deploy)
    expect(politicas("sonda_rls_modulo")).toContain("tenant_isolation_sonda_rls_modulo_all:P:*");
  });
});

describe("banco existente e instalação nova", () => {
  const RETRATO = `
    select string_agg(linha, E'\\n' order by linha) from (
      select 'RLS ' || c.relname || ' ' || c.relrowsecurity::text as linha
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and c.relname not like 'sonda_rls_%'
      union all
      select 'POL ' || c.relname || ' ' || p.polname || ' ' || p.polpermissive::text || ' ' || p.polcmd::text || ' '
             || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
             || ' ' || array_to_string(array(select r::regrole::text from unnest(p.polroles) r order by 1), ',')
        from pg_policy p join pg_class c on c.oid = p.polrelid
       where c.relnamespace = 'public'::regnamespace and c.relname not like 'sonda_rls_%'
      union all
      select 'GRANT ' || table_name || ' ' || grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon','authenticated','service_role') and table_name not like 'sonda_rls_%'
       group by table_name, grantee
    ) t;`;

  it("E — no banco existente (baseline sem o trigger) a régua nova não seleciona tabela nenhuma", () => {
    // O molde comum é o banco de quem já instalou: a varredura nova tem de ser no-op nele.
    const antes = psqlEm(moldeComum as string, RETRATO);
    const banco = "inv_rls_ensure_existente";
    psqlEm("template1", `drop database if exists ${banco} with (force);\ncreate database ${banco} template ${moldeComum};`);
    try {
      psqlEm(banco, `select public.fn_proteger_tabelas_sob_ensure_rls(); select public.fn_aplicar_travas_de_suporte();`);
      expect(psqlEm(banco, RETRATO)).toBe(antes);
    } finally {
      psqlEm("template1", `drop database if exists ${banco} with (force);`);
    }
  });

  it("D/F — o baseline aplicado DUAS vezes num projeto recente chega ao mesmo RLS, policies e grants do molde comum", () => {
    expect(psqlEm(moldeRecente as string, `select count(*) from pg_event_trigger where evtname = 'ensure_rls';`)).toBe("1");
    expect(psqlEm(moldeRecente as string, `select count(*) from test_db.aplicacoes_do_baseline;`)).toBe("2");
    const comum = psqlEm(moldeComum as string, RETRATO).split("\n");
    const recente = psqlEm(moldeRecente as string, RETRATO).split("\n");
    const so = (a: string[], b: string[], prefixo: string) => a.filter((l) => l.startsWith(prefixo) && !b.includes(l));
    // RLS e policies de acesso: IGUAIS. (As `support_write_*` derivam do grant e são cobradas abaixo.)
    const semTravas = (l: string) => !/^POL \S+ support_write_/.test(l);
    expect({
      rls: [...so(comum, recente, "RLS "), ...so(recente, comum, "RLS ")],
      politicas: [...so(comum, recente, "POL "), ...so(recente, comum, "POL ")].filter(semTravas),
    }).toEqual({ rls: [], politicas: [] });
    // Grants: o projeto recente (default ACL novo — o do Oregon de produção) pode ser
    // MAIS restrito que o molde comum, NUNCA mais permissivo.
    const grants = (linhas: string[]) => new Map(linhas.filter((l) => l.startsWith("GRANT ")).map((l) => {
      const [, tabela, papel, privs] = l.split(" "); return [`${tabela} ${papel}`, new Set((privs ?? "").split(","))];
    }));
    const gc = grants(comum), gr = grants(recente);
    const aMais = [...gr].flatMap(([k, ps]) => [...ps].filter((p) => !gc.get(k)?.has(p)).map((p) => `${k} ${p}`));
    expect(aMais).toEqual([]);
    // Trava de suporte ausente no recente só onde `authenticated` não pode escrever (server-only).
    const travasSoNoComum = so(comum, recente, "POL ").filter((l) => !semTravas(l)).map((l) => l.split(" ")[1]);
    const comEscrita = [...new Set(travasSoNoComum)].filter((t) =>
      psqlEm(moldeRecente as string, `select has_table_privilege('authenticated','public.${t}','insert') or has_table_privilege('authenticated','public.${t}','update') or has_table_privilege('authenticated','public.${t}','delete');`) === "t");
    expect(comEscrita).toEqual([]);
  });
});
