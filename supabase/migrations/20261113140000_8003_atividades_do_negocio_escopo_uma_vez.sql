-- manifest: **A linha do tempo do contato e do negócio abre em milissegundos: a leitura de `crm_lead_activities` e `crm_lead_links` calcula o escopo do usuário UMA vez por consulta, não `fn_can_view_lead` em cada negócio.** As duas policies de leitura faziam `exists (select 1 from crm_leads l where l.id = <filha>.lead_id and fn_can_view_lead(l.organization_id, l.owner_user_id))`. Como a função é `security definer` e nunca é embutida, o planejador montava o conjunto de negócios visíveis chamando-a para TODOS os negócios da organização. Medido em produção (13/11/2026, 348 negócios, papel manager): a consulta da ficha do contato com 50 atividades levava 1.061 ms, todos eles no `Seq Scan on crm_leads` com a função por linha. No `pg_stat_statements` ela somava 2.877 chamadas, média de 933 ms e 4,5% do tempo total do banco desde 01/10. A regra passa a ser a mesma de `crm_leads_select` (0656), dentro do `exists` no negócio-pai: `fn_escopo_de_conversas()` avaliada uma vez. A visibilidade não muda: o `exists` continua fechando o caso do negócio oculto, e `fn_can_view_lead` segue intacta para as escritas e os comandos. Corresponde à parte das tabelas filhas da 9313 do upstream (#4323); a parte de `crm_leads` o fork já tinha pela 0656. Faixa 8xxx: número próprio do fork. No `supabase/baseline.sql`, as duas policies foram trocadas no lugar, no bloco da 0036 (a cerca `baseline-nao-constroi-o-que-derruba` proíbe versão intermediária); prova em `tests/invariants/atividades-do-negocio-escopo-uma-vez.test.ts`.
--
-- 8003 — escopo das filhas do negócio calculado uma vez por consulta.
--
-- `drop` e `create` de cada policy no MESMO bloco `do`: o `update.sh` roda sem
-- ON_ERROR_STOP, e um `create` que falhasse depois de um `drop` solto deixaria a
-- tabela sem policy de leitura (que, com RLS ligada, vira "ninguém lê").

do $crm_lead_activities_select$ begin
  drop policy if exists "crm_lead_activities_select" on public.crm_lead_activities;
  create policy "crm_lead_activities_select" on public.crm_lead_activities
    for select using (
      exists (
        select 1 from public.crm_leads l
        where l.id = crm_lead_activities.lead_id
          and (
            (select public.fn_is_platform_admin())
            or l.organization_id in (
                 select e.organization_id from public.fn_escopo_de_conversas() e where e.ve_todas)
            or (l.owner_user_id = (select auth.uid())
                and l.organization_id in (
                     select e.organization_id from public.fn_escopo_de_conversas() e))
            or (l.owner_user_id is null
                and l.organization_id in (
                     select e.organization_id from public.fn_escopo_de_conversas() e
                      where e.ve_nao_atribuidas))
          )
      )
    );
end $crm_lead_activities_select$;

do $crm_lead_links_select$ begin
  drop policy if exists "crm_lead_links_select" on public.crm_lead_links;
  create policy "crm_lead_links_select" on public.crm_lead_links
    for select using (
      exists (
        select 1 from public.crm_leads l
        where l.id = crm_lead_links.lead_id
          and (
            (select public.fn_is_platform_admin())
            or l.organization_id in (
                 select e.organization_id from public.fn_escopo_de_conversas() e where e.ve_todas)
            or (l.owner_user_id = (select auth.uid())
                and l.organization_id in (
                     select e.organization_id from public.fn_escopo_de_conversas() e))
            or (l.owner_user_id is null
                and l.organization_id in (
                     select e.organization_id from public.fn_escopo_de_conversas() e
                      where e.ve_nao_atribuidas))
          )
      )
    );
end $crm_lead_links_select$;
