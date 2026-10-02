-- ---- proteção de tabela de organização sob o `ensure_rls` do Supabase (migration 0521) ----
--
-- Projetos Supabase recentes têm o event trigger `ensure_rls`, que LIGA a RLS de
-- toda tabela criada em `public` no próprio CREATE TABLE. A régua da 0325
-- (`fn_proteger_tabelas_de_organizacao`, "RLS desligada") fica cega a isso: a
-- tabela nova chega com RLS ligada e SEM a policy de isolamento — negada para todo
-- usuário do CRM (medido no projeto de Estocolmo: 33 tabelas, corrigidas à mão).
--
-- A régua da 0325 NÃO muda — o contrato dela ("tabela que liga a RLS sozinha
-- decidiu a própria proteção") é vigiado pelos invariantes da provisionadora e das
-- notas internas, e há tabelas que ligam a RLS cedo e só ganham as policies muito
-- depois no arquivo (`conversation_notes`: RLS na 0198, policies na 0478). Esta
-- função é OUTRA, com régua estreita, e roda SÓ no último bloco do arquivo,
-- quando toda policy já existe:
--   - RLS ligada, NENHUMA policy permissiva e algum privilégio de `authenticated`
--     → recebe o isolamento (o que o `ensure_rls` deixou para trás);
--   - server-only (RLS e zero policy de propósito) não dá privilégio a
--     `authenticated` → intocada, como as 17 de hoje;
--   - policy própria por papel é permissiva → intocada;
--   - "permissiva", e não "qualquer": as travas do suporte (0274) criam policies
--     RESTRITIVAS, que sozinhas negam tudo — o caso das 33;
--   - `catalog_read_*` não conta: abre só linhas GLOBAIS (organization_id is null).
-- Medido em 2026-10-02 nos projetos de Oregon e de Estocolmo: seleciona 0 das 152
-- tabelas de organização — no-op em quem já instalou.
-- Vigiado por tests/invariants/rls-tabela-nova-com-ensure-rls.test.ts e, a posição
-- da chamada, por tests/unit/protecao-sob-ensure-rls-e-o-ultimo-bloco.test.ts.
create or replace function public.fn_proteger_tabelas_sob_ensure_rls()
returns void
language plpgsql
set search_path = public
as $f$
declare r record;
begin
 for r in
   select c.relname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and exists (
        select 1 from pg_attribute a
         where a.attrelid = c.oid
           and a.attname = 'organization_id'
           and a.attnum > 0
           and not a.attisdropped)
      and not exists (select 1 from pg_policy p
                       where p.polrelid = c.oid and p.polpermissive
                         and p.polname not like 'catalog\_read\_%')
      and (has_table_privilege('authenticated', c.oid, 'select')
        or has_table_privilege('authenticated', c.oid, 'insert')
        or has_table_privilege('authenticated', c.oid, 'update')
        or has_table_privilege('authenticated', c.oid, 'delete'))
    order by c.relname
 loop
   execute format('revoke all on public.%I from anon', r.relname);
   execute format('drop policy if exists tenant_isolation_%s_all on public.%I', r.relname, r.relname);
   execute format(
     'create policy tenant_isolation_%s_all on public.%I for all
        using (organization_id in (select * from public.fn_user_org_ids()))
        with check (organization_id in (select * from public.fn_user_org_ids()))',
     r.relname, r.relname);
 end loop;
end $f$;

revoke execute on function public.fn_proteger_tabelas_sob_ensure_rls() from public, anon, authenticated, service_role;

-- Uma vez, agora que o banco já tem todas as policies: cura o que o `ensure_rls`
-- deixou para trás e reaplica as travas do suporte nas tabelas recém-protegidas.
do $f$ begin
  perform public.fn_proteger_tabelas_sob_ensure_rls();
  perform public.fn_aplicar_travas_de_suporte();
end $f$;
