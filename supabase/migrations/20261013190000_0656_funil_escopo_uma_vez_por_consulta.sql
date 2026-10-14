-- manifest: **O quadro do funil abre em funil grande: a RLS de leitura de `crm_leads` calcula o escopo do usuário UMA vez por consulta, não uma vez por negócio.** `crm_leads_select` chamava `fn_can_view_lead` por linha — `security definer` não é embutida, e cada chamada rodava `fn_is_platform_admin` + `fn_user_role_in_org` ×2 (cada uma com `fn_support_context`). É o mesmo defeito que a 0560 corrigiu em `conversations`; no funil "Contatos" de produção a rota `/api/v1/pipelines/:id/board` passava dos 10 s do cliente ("A requisição não respondeu em 10000ms"). A policy passa a usar `fn_escopo_de_conversas()` (0560: papel e `visibility_mode` da organização, a mesma régua de `fn_can_view_lead`) em subconsultas não correlacionadas. `fn_can_view_lead` não muda e segue nos outros usos. Sem função nova, sem dado tocado; idempotente (`drop policy if exists` + `create policy`). Baseline editado NO LUGAR (versão final, como a 0560). Gate: `tests/invariants/funil-escopo-uma-vez-por-consulta.test.ts` (equivalência por matriz de papéis × `visibility_mode` × dono, e chamadas de `fn_user_role_in_org` constantes no número de linhas).
-- 0656 — a leitura do funil calcula o escopo do usuário uma vez por consulta.

drop policy if exists "crm_leads_select" on public.crm_leads;
create policy "crm_leads_select" on public.crm_leads
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (
      select e.organization_id from public.fn_escopo_de_conversas() e where e.ve_todas)
    or (owner_user_id = (select auth.uid())
        and organization_id in (
          select e.organization_id from public.fn_escopo_de_conversas() e))
    or (owner_user_id is null
        and organization_id in (
          select e.organization_id from public.fn_escopo_de_conversas() e where e.ve_nao_atribuidas))
  );

notify pgrst, 'reload schema';
