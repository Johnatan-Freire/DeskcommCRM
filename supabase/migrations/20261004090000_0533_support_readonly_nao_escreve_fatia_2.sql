-- manifest: **Platform admin `support_readonly` deixa de escrever nas 45 policies restantes da #2115 (36 das 47 listadas + 9 dinâmicas) — e a conta de escrita com a função pura fecha em 0.** Medição na `main@17c4b81b8`, depois do #2193: 36 policies de escrita com `fn_is_platform_admin()` puro, em 28 tabelas. **29 são troca direta** de policies de topo (cada tabela já tem `*_select` com a função pura, ou `fn_can_view_*`, que começa com `when fn_is_platform_admin() then true`); **6 são as policies internas de `fn_honorarios_provisionar`** (módulo honorários, ADR-0002) — a definição da função passa a criar as escritas com `_full` e mantém as duas SELECT com a pura; para quem já tem o módulo, quem reconstrói as policies é a reaplicação explícita (D6), que o fim do baseline roda em toda atualização; **1 é o único par**: `recurring_entries`, a única tabela das 47 sem `SELECT` própria — `_read` (pura) + `_write` (`_full`), preservando a assimetria do `_all` (using = membro ou plataforma; with check = plataforma ou membro+manager). Mesmo desenho da 0529: baseline editado no lugar (as 3 duplicatas de `attendant_availability` trocadas nas DUAS cópias) e invariante estendido — catálogo das 36, conta global de escrita em 0, comportamento do par e o módulo honorários instalado no próprio teste. **+9 dinâmicas** que a lista de 47 não via (a busca não enxerga `format()`) e a conta global achou: os dois blocos `do $$ foreach` de 0350 (`financial_accounts`, `payment_methods`, `account_plans`, with check manager) e 0351 (`sales`, `sale_items`, `commission_rules`, `commissions`, `financial_entries`, `loyalty_ledger`, with check agent) — `_all` vira o mesmo par `_read`/`_write` de `recurring_entries`.

-- 0533: fatia 2 da #2115 — a prioridade 5 do issue (o resto da lista).
--
-- A #2115 mediu 47 policies de escrita com fn_is_platform_admin() no trecho que
-- a 0508 não varreu (apêndices do baseline). A fatia 1 (0529, PR #2193) fechou
-- as 11 da prioridade 1 a 4; esta fecha as 36 restantes da lista e mais 9 que a
-- lista não via (dois blocos dinâmicos do baseline, `format()`): 45 ao todo.
--
-- Quatro formas, todas no mesmo desenho:
--   · 29 TROCAS DIRETAS em policies de topo — cada tabela já tem SELECT própria
--     com a função pura (ou fn_can_view_*, que começa com
--     `when fn_is_platform_admin() then true`);
--   · 6 POLICIES INTERNAS do módulo honorários (ADR-0002): o corpo de
--     fn_honorarios_provisionar é redefinido aqui e no baseline; as duas SELECT
--     seguem com a função pura e as seis de escrita passam a `_full`. Para quem
--     já tem o módulo, a policy nasce no provisionamento: quem a reconstrói é a
--     reaplicação explícita (D6), que o fim do baseline roda em toda atualização;
--   · 1 PAR — recurring_entries era a única das 47 sem SELECT própria;
--   · 9 PARES DINÂMICOS — os laços de 0350 e 0351 criavam `tenant_isolation_%I_all`
--     com a pura; viram o mesmo par `_read`/`_write` (fim deste arquivo).
--
-- Idempotente: drop policy if exists antes de cada create; create or replace
-- na função; a reaplicação é o mesmo comando do fim do baseline.
--
-- Medido em banco pelo invariante estendido
-- (tests/invariants/platform-admin-full-so-escreve.test.ts): catálogo das 45
-- expressões vivas, conta global de escrita com a função pura em 0, comportamento
-- do par de recurring_entries e o módulo honorários instalado dentro do teste.

drop policy if exists tenant_isolation_ai_agents_write on public.ai_agents;
create policy tenant_isolation_ai_agents_write on public.ai_agents
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists tenant_isolation_ai_budgets_write on public.ai_budgets;
create policy tenant_isolation_ai_budgets_write on public.ai_budgets
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists tenant_isolation_ai_chunks_write on public.ai_chunks;
create policy tenant_isolation_ai_chunks_write on public.ai_chunks
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists tenant_isolation_ai_knowledge_sources_write on public.ai_knowledge_sources;
create policy tenant_isolation_ai_knowledge_sources_write on public.ai_knowledge_sources
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin_full()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists tenant_isolation_ai_kbv_write on public.ai_knowledge_versions;
create policy tenant_isolation_ai_kbv_write on public.ai_knowledge_versions
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists attendant_availability_delete on public.attendant_availability;
create policy "attendant_availability_delete" on public.attendant_availability
  for delete using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = auth.uid()
             or public.fn_role_at_least(organization_id, 'manager')))
  );

drop policy if exists attendant_availability_insert on public.attendant_availability;
create policy "attendant_availability_insert" on public.attendant_availability
  for insert with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = auth.uid()
             or public.fn_role_at_least(organization_id, 'manager')))
  );

drop policy if exists attendant_availability_update on public.attendant_availability;
create policy "attendant_availability_update" on public.attendant_availability
  for update using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = auth.uid()
             or public.fn_role_at_least(organization_id, 'manager')))
  ) with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = auth.uid()
             or public.fn_role_at_least(organization_id, 'manager')))
  );

drop policy if exists automation_rules_manager_write on public.automation_rules;
create policy "automation_rules_manager_write" on public.automation_rules
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists calendar_appointments_write on public.calendar_appointments;
create policy calendar_appointments_write on public.calendar_appointments
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

drop policy if exists calendar_availability_exceptions_write on public.calendar_availability_exceptions;
create policy calendar_availability_exceptions_write on public.calendar_availability_exceptions
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager')))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager')))
  );

drop policy if exists calendar_event_types_write on public.calendar_event_types;
create policy calendar_event_types_write on public.calendar_event_types
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists calendar_locations_insert on public.calendar_locations;
create policy calendar_locations_insert on public.calendar_locations
  for insert with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

drop policy if exists campaign_channel_sessions_write on public.campaign_channel_sessions;
create policy campaign_channel_sessions_write on public.campaign_channel_sessions
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists campaign_recipients_write on public.campaign_recipients;
create policy campaign_recipients_write on public.campaign_recipients
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists campaign_suppressions_write on public.campaign_suppressions;
create policy campaign_suppressions_write on public.campaign_suppressions
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists campaign_templates_write on public.campaign_templates;
create policy campaign_templates_write on public.campaign_templates
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists campaigns_write on public.campaigns;
create policy campaigns_write on public.campaigns
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_products_write on public.catalog_products;
create policy catalog_products_write on public.catalog_products
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists crm_lead_activities_insert on public.crm_lead_activities;
create policy "crm_lead_activities_insert" on public.crm_lead_activities
  for insert with check (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists crm_lead_links_delete on public.crm_lead_links;
create policy "crm_lead_links_delete" on public.crm_lead_links
  for delete using (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists crm_lead_links_insert on public.crm_lead_links;
create policy "crm_lead_links_insert" on public.crm_lead_links
  for insert with check (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists crm_lead_links_update on public.crm_lead_links;
create policy "crm_lead_links_update" on public.crm_lead_links
  for update using (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin_full()
  ) with check (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin_full()
  );

drop policy if exists crm_pipelines_manager_write on public.crm_pipelines;
create policy "crm_pipelines_manager_write" on public.crm_pipelines
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists crm_stages_manager_write on public.crm_stages;
create policy "crm_stages_manager_write" on public.crm_stages
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists crm_tasks_write on public.crm_tasks;
create policy crm_tasks_write on public.crm_tasks
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

drop policy if exists org_guardrail_layers_admin_write on public.org_guardrail_layers;
create policy org_guardrail_layers_admin_write on public.org_guardrail_layers
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  );

drop policy if exists org_voice_calls_admin_write on public.org_voice_calls;
create policy org_voice_calls_admin_write on public.org_voice_calls
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  );

drop policy if exists webhook_sources_manager_write on public.webhook_sources;
create policy "webhook_sources_manager_write" on public.webhook_sources
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists tenant_isolation_recurring_entries_all on public.recurring_entries;
drop policy if exists tenant_isolation_recurring_entries_read on public.recurring_entries;
create policy tenant_isolation_recurring_entries_read on public.recurring_entries
  for select
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
drop policy if exists tenant_isolation_recurring_entries_write on public.recurring_entries;
create policy tenant_isolation_recurring_entries_write on public.recurring_entries
  for all
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin_full())
  with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ---- (fork) fn_honorarios_provisionar FICA DE FORA ----
-- No upstream, aqui a definição do provisionador do módulo de honorários
-- (ADR-0002) passa a criar as 6 policies internas com `_full`. Este fork não
-- tem o módulo de honorários (nem a função, nem as tabelas): redefini-la aqui
-- criaria um provisionador sem uso. Nada a trocar.

-- ---- as 9 dos dois blocos dinâmicos (0350 e 0351): _all vira par ----
-- Ficaram fora da lista de 47 da #2115 porque a busca que a montou não enxerga
-- `format()`. A conta global do invariante as achou. Mesmo par de
-- recurring_entries: _read com a função pura, _write com `_full`.
do $$
declare t text; papel text;
begin
  foreach t in array array['financial_accounts', 'payment_methods', 'account_plans',
                           'sales', 'sale_items', 'commission_rules', 'commissions',
                           'financial_entries', 'loyalty_ledger'] loop
    -- Dinheiro de configuração (0350) é manager+; o que a comanda move (0351), agent+.
    papel := case when t in ('financial_accounts', 'payment_methods', 'account_plans')
                  then 'manager' else 'agent' end;
    execute format('drop policy if exists tenant_isolation_%I_all on public.%I', t, t);
    execute format('drop policy if exists tenant_isolation_%I_read on public.%I', t, t);
    execute format($f$
      create policy tenant_isolation_%I_read on public.%I
        for select
        using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
    $f$, t, t);
    execute format('drop policy if exists tenant_isolation_%I_write on public.%I', t, t);
    execute format($f$
      create policy tenant_isolation_%I_write on public.%I
        for all
        using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin_full())
        with check (
          public.fn_is_platform_admin_full()
          or (organization_id in (select public.fn_user_org_ids())
              and public.fn_role_at_least(organization_id, %L))
        )
    $f$, t, t, papel);
  end loop;
end $$;
