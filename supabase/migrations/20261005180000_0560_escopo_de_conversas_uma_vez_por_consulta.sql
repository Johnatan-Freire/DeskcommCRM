-- ---- escopo de conversas calculado UMA vez por consulta (migration 0560) ----
--
-- `conversations_select` chamava `fn_can_view_conversation(organization_id,
-- assigned_to_user_id)` POR LINHA. A função é `security definer` com
-- `set search_path` — o Postgres nunca a embute — e, para quem não é admin de
-- plataforma, cada chamada roda `fn_is_platform_admin` + `fn_user_role_in_org`
-- DUAS vezes, e cada `fn_user_role_in_org` roda `fn_support_context` (join de
-- cinco tabelas). Nada disso depende da linha; dependia só do usuário.
--
-- Medido em 2026-10-05 no projeto de produção (86 conversas, contagem por org
-- como o `count=exact` do PostgREST): admin comum 609 ms / 2.459 buffers,
-- agent 299 ms / 3.148 buffers; platform admin 28 ms (sai no primeiro `when`).
-- `/api/v1/conversations/counts` dispara seis dessas em paralelo por
-- carregamento do Inbox, e o pg_stat_statements registrava média de 1,8 s em
-- cada. O custo crescia LINEAR com o número de conversas.
--
-- A policy passa a ler o escopo do usuário por subconsultas NÃO correlacionadas
-- — o planner as executa uma vez (initplan / subplan com hash) e cada linha só
-- testa pertinência. Mesmo predicado, simulado em produção: 4–18 ms, ~30
-- buffers, e ZERO divergência de visibilidade nos quatro usuários reais.
--
-- A semântica é a de `fn_can_view_conversation`, por construção:
--   - admin de plataforma → tudo;
--   - papel nulo na org (não membro) → nada;
--   - viewer/manager/admin → tudo da org;
--   - atribuída a mim → visível (com papel na org);
--   - senão, `visibility_mode` da org: 'all' → tudo; 'own_and_unassigned'
--     (padrão quando ausente) → as sem dono; qualquer outro valor → nada.
-- O papel continua vindo de `fn_user_role_in_org` (sessão de suporte inclusa),
-- chamado uma vez por org do usuário em vez de duas por conversa.
-- `fn_can_view_conversation` NÃO muda: segue em uso nas policies e RPCs que
-- testam UMA conversa. A equivalência das duas é vigiada por
-- tests/invariants/conversas-escopo-uma-vez-por-consulta.test.ts, que também
-- prova que o número de chamadas de `fn_user_role_in_org` não cresce com as
-- linhas. Mesmo nome de policy: o deploy confere as regras pelo nome.

create or replace function public.fn_escopo_de_conversas()
returns table (organization_id uuid, ve_todas boolean, ve_nao_atribuidas boolean)
language sql stable security definer
set search_path = public
as $$
  select o.org,
         r.role in ('viewer', 'manager', 'admin')
           or coalesce(g.settings->>'visibility_mode', 'own_and_unassigned') = 'all',
         coalesce(g.settings->>'visibility_mode', 'own_and_unassigned') = 'own_and_unassigned'
    from (select distinct x as org from public.fn_user_org_ids() x) o
    cross join lateral (select public.fn_user_role_in_org(o.org) as role) r
    left join public.organizations g on g.id = o.org
   where r.role is not null;
$$;

revoke execute on function public.fn_escopo_de_conversas() from public, anon;
grant execute on function public.fn_escopo_de_conversas() to authenticated, service_role;

drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (
      select e.organization_id from public.fn_escopo_de_conversas() e where e.ve_todas)
    or (assigned_to_user_id = (select auth.uid())
        and organization_id in (
          select e.organization_id from public.fn_escopo_de_conversas() e))
    or (assigned_to_user_id is null
        and organization_id in (
          select e.organization_id from public.fn_escopo_de_conversas() e where e.ve_nao_atribuidas))
  );
