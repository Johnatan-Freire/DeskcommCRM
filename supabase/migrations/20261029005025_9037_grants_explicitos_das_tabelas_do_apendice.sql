-- manifest: **Privilégios explícitos, por tabela e por papel, nas 48 tabelas do apêndice que dependiam do default ACL (#3140, decisão 219 = A).** A partir de 30/10/2026 a Supabase deixa de conceder privilégio automático em tabela nova de `public`; uma tabela criada sem `GRANT` próprio fica inalcançável pela Data API. Em vez de reabrir o default amplo (recusado no #3521 e no #3612), cada tabela recebe o que o uso legítimo pede: `service_role` com select/insert/update/delete; `authenticated` só com os comandos para os quais a RLS da tabela tem policy permissiva (28 com as quatro — uma delas, `automation_rule_runs`, por exceção declarada no bloco —, 1 com select/insert, 13 só com select, 6 sem nada); `anon` com nada — nenhuma delas tem policy que um visitante satisfaça. TRUNCATE, REFERENCES e TRIGGER saem dos três papéis. O estado final é o mesmo com ou sem o corte do provedor, porque cada tabela começa por `revoke all`. Tudo num bloco `do` só: o `update.sh` roda sem transação única, e revoke e grant em comandos soltos abririam uma janela de `permission denied` para o app no ar. Ficam de fora, de propósito: `modulo_secoes_lgpd` (fechada a todos, inclusive `service_role` — ADR-0002 D8) e as 7 tabelas que os módulos opcionais criam em tempo de execução (honorários, vendas): elas nascem dentro das funções provisionadoras e pedem `grant` lá dentro, em recorte próprio. O corpo do baseline (`ALTER DEFAULT PRIVILEGES … ON TABLES`) não muda. Espelho no apêndice do `supabase/baseline.sql`, logo antes da chamada final das travas de suporte; prova em `tests/invariants/grants-explicitos-das-tabelas-do-apendice.test.ts`.
--
-- Como a lista foi medida (num banco instalado do baseline, pelo test:db):
--   - tabelas que o apêndice cria em `public` sem `grant … on public.<t>` próprio: 56;
--   - 49 existem depois do install; as 7 restantes são as de módulo opcional;
--   - para cada uma, o ACL atual (`aclexplode`) e as policies (`pg_policies`):
--     o `authenticated` daqui é o ACL atual ∩ comandos com policy PERMISSIVA para
--     `public`/`authenticated` (as `support_write_*` são restritivas e não contam);
--   - escrita por `authenticated` nas 6 tabelas que perdem comando de escrita
--     (calendar_connection_calendars, calendar_connections,
--     calendar_locations [update/delete], system_update_runs, system_version,
--     webhook_lead_captures): no código, só pelo cliente admin ou por função
--     `security definer` (fn_google_*, fn_redigir_captacoes_do_contato_anonimizado).
--
-- Tabela nova no apêndice passa a precisar de `grant` próprio: o invariante acima
-- reprova a que nascer sem ele e sem entrada na lista de exceções.

do $grants_9037$
begin
  -- Fork: cada par só roda se a tabela existe — várias das 48 do upstream
  -- não foram portadas (carteira, cobrança, MFA confiável, anexos de campo…).
  -- authenticated com as quatro: a RLS tem policy permissiva para cada comando.
  if to_regclass('public.account_plans') is not null then
    revoke all on table public.account_plans from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.account_plans to authenticated, service_role;
  end if;
  if to_regclass('public.ai_purpose_bindings') is not null then
    revoke all on table public.ai_purpose_bindings from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.ai_purpose_bindings to authenticated, service_role;
  end if;
  if to_regclass('public.attendant_availability') is not null then
    revoke all on table public.attendant_availability from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.attendant_availability to authenticated, service_role;
  end if;
  if to_regclass('public.automation_rules') is not null then
    revoke all on table public.automation_rules from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.automation_rules to authenticated, service_role;
  end if;
  if to_regclass('public.calendar_appointments') is not null then
    revoke all on table public.calendar_appointments from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.calendar_appointments to authenticated, service_role;
  end if;
  if to_regclass('public.calendar_availability_exceptions') is not null then
    revoke all on table public.calendar_availability_exceptions from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.calendar_availability_exceptions to authenticated, service_role;
  end if;
  if to_regclass('public.calendar_event_types') is not null then
    revoke all on table public.calendar_event_types from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.calendar_event_types to authenticated, service_role;
  end if;
  if to_regclass('public.contact_field_proposals') is not null then
    revoke all on table public.contact_field_proposals from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.contact_field_proposals to authenticated, service_role;
  end if;
  if to_regclass('public.crm_lead_attachments') is not null then
    revoke all on table public.crm_lead_attachments from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.crm_lead_attachments to authenticated, service_role;
  end if;
  if to_regclass('public.crm_lead_reactivations') is not null then
    revoke all on table public.crm_lead_reactivations from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.crm_lead_reactivations to authenticated, service_role;
  end if;
  if to_regclass('public.crm_lead_risk_states') is not null then
    revoke all on table public.crm_lead_risk_states from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.crm_lead_risk_states to authenticated, service_role;
  end if;
  if to_regclass('public.crm_lead_scores') is not null then
    revoke all on table public.crm_lead_scores from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.crm_lead_scores to authenticated, service_role;
  end if;
  if to_regclass('public.demanda_conversas') is not null then
    revoke all on table public.demanda_conversas from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.demanda_conversas to authenticated, service_role;
  end if;
  if to_regclass('public.demandas') is not null then
    revoke all on table public.demandas from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.demandas to authenticated, service_role;
  end if;
  if to_regclass('public.external_db_connections') is not null then
    revoke all on table public.external_db_connections from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.external_db_connections to authenticated, service_role;
  end if;
  if to_regclass('public.financial_accounts') is not null then
    revoke all on table public.financial_accounts from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.financial_accounts to authenticated, service_role;
  end if;
  if to_regclass('public.financial_entries') is not null then
    revoke all on table public.financial_entries from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.financial_entries to authenticated, service_role;
  end if;
  if to_regclass('public.lead_field_proposals') is not null then
    revoke all on table public.lead_field_proposals from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.lead_field_proposals to authenticated, service_role;
  end if;
  if to_regclass('public.meta_templates') is not null then
    revoke all on table public.meta_templates from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.meta_templates to authenticated, service_role;
  end if;
  if to_regclass('public.org_guardrail_layers') is not null then
    revoke all on table public.org_guardrail_layers from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.org_guardrail_layers to authenticated, service_role;
  end if;
  if to_regclass('public.org_voice_calls') is not null then
    revoke all on table public.org_voice_calls from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.org_voice_calls to authenticated, service_role;
  end if;
  if to_regclass('public.payment_methods') is not null then
    revoke all on table public.payment_methods from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.payment_methods to authenticated, service_role;
  end if;
  if to_regclass('public.phone_numbers') is not null then
    revoke all on table public.phone_numbers from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.phone_numbers to authenticated, service_role;
  end if;
  if to_regclass('public.recurring_entries') is not null then
    revoke all on table public.recurring_entries from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.recurring_entries to authenticated, service_role;
  end if;
  if to_regclass('public.voice_calls') is not null then
    revoke all on table public.voice_calls from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.voice_calls to authenticated, service_role;
  end if;
  if to_regclass('public.voip_trunk_settings') is not null then
    revoke all on table public.voip_trunk_settings from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.voip_trunk_settings to authenticated, service_role;
  end if;
  if to_regclass('public.webhook_sources') is not null then
    revoke all on table public.webhook_sources from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.webhook_sources to authenticated, service_role;
  end if;

  -- A única exceção à régua: a RLS só tem policy permissiva de select, mas
  -- `tests/invariants/webhooks-rls.test.ts` mede a recusa da escrita direta
  -- como negação da RLS (0 linhas), não como falta de privilégio. Mantém as
  -- quatro, como hoje, até essa medição ser revista.
  if to_regclass('public.automation_rule_runs') is not null then
    revoke all on table public.automation_rule_runs from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.automation_rule_runs to authenticated, service_role;
  end if;

  -- authenticated lê e cria: não há policy permissiva de update/delete.
  if to_regclass('public.calendar_locations') is not null then
    revoke all on table public.calendar_locations from anon, authenticated, service_role;
    grant select, insert on table public.calendar_locations to authenticated;
    grant select, insert, update, delete on table public.calendar_locations to service_role;
  end if;

  -- authenticated só lê: a escrita é do servidor (policy permissiva só de select).
  if to_regclass('public.calendar_connection_calendars') is not null then
    revoke all on table public.calendar_connection_calendars from anon, authenticated, service_role;
    grant select on table public.calendar_connection_calendars to authenticated;
    grant select, insert, update, delete on table public.calendar_connection_calendars to service_role;
  end if;
  if to_regclass('public.calendar_connections') is not null then
    revoke all on table public.calendar_connections from anon, authenticated, service_role;
    grant select on table public.calendar_connections to authenticated;
    grant select, insert, update, delete on table public.calendar_connections to service_role;
  end if;
  if to_regclass('public.calendar_resources') is not null then
    revoke all on table public.calendar_resources from anon, authenticated, service_role;
    grant select on table public.calendar_resources to authenticated;
    grant select, insert, update, delete on table public.calendar_resources to service_role;
  end if;
  if to_regclass('public.calendar_service_blocks') is not null then
    revoke all on table public.calendar_service_blocks from anon, authenticated, service_role;
    grant select on table public.calendar_service_blocks to authenticated;
    grant select, insert, update, delete on table public.calendar_service_blocks to service_role;
  end if;
  if to_regclass('public.calendar_service_calendar_sources') is not null then
    revoke all on table public.calendar_service_calendar_sources from anon, authenticated, service_role;
    grant select on table public.calendar_service_calendar_sources to authenticated;
    grant select, insert, update, delete on table public.calendar_service_calendar_sources to service_role;
  end if;
  if to_regclass('public.calendar_service_occurrence_resources') is not null then
    revoke all on table public.calendar_service_occurrence_resources from anon, authenticated, service_role;
    grant select on table public.calendar_service_occurrence_resources to authenticated;
    grant select, insert, update, delete on table public.calendar_service_occurrence_resources to service_role;
  end if;
  if to_regclass('public.calendar_service_occurrences') is not null then
    revoke all on table public.calendar_service_occurrences from anon, authenticated, service_role;
    grant select on table public.calendar_service_occurrences to authenticated;
    grant select, insert, update, delete on table public.calendar_service_occurrences to service_role;
  end if;
  if to_regclass('public.calendar_service_professionals') is not null then
    revoke all on table public.calendar_service_professionals from anon, authenticated, service_role;
    grant select on table public.calendar_service_professionals to authenticated;
    grant select, insert, update, delete on table public.calendar_service_professionals to service_role;
  end if;
  if to_regclass('public.calendar_service_resources') is not null then
    revoke all on table public.calendar_service_resources from anon, authenticated, service_role;
    grant select on table public.calendar_service_resources to authenticated;
    grant select, insert, update, delete on table public.calendar_service_resources to service_role;
  end if;
  if to_regclass('public.calendar_service_schedule') is not null then
    revoke all on table public.calendar_service_schedule from anon, authenticated, service_role;
    grant select on table public.calendar_service_schedule to authenticated;
    grant select, insert, update, delete on table public.calendar_service_schedule to service_role;
  end if;
  if to_regclass('public.channel_session_groups') is not null then
    revoke all on table public.channel_session_groups from anon, authenticated, service_role;
    grant select on table public.channel_session_groups to authenticated;
    grant select, insert, update, delete on table public.channel_session_groups to service_role;
  end if;
  if to_regclass('public.conversation_assignment_events') is not null then
    revoke all on table public.conversation_assignment_events from anon, authenticated, service_role;
    grant select on table public.conversation_assignment_events to authenticated;
    grant select, insert, update, delete on table public.conversation_assignment_events to service_role;
  end if;
  if to_regclass('public.webhook_lead_captures') is not null then
    revoke all on table public.webhook_lead_captures from anon, authenticated, service_role;
    grant select on table public.webhook_lead_captures to authenticated;
    grant select, insert, update, delete on table public.webhook_lead_captures to service_role;
  end if;

  -- Só do servidor: nenhuma policy permissiva para authenticated.
  if to_regclass('public.calendar_oauth_nonces') is not null then
    revoke all on table public.calendar_oauth_nonces from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.calendar_oauth_nonces to service_role;
  end if;
  if to_regclass('public.crm_proposal_counters') is not null then
    revoke all on table public.crm_proposal_counters from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.crm_proposal_counters to service_role;
  end if;
  if to_regclass('public.mfa_trusted_devices') is not null then
    revoke all on table public.mfa_trusted_devices from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.mfa_trusted_devices to service_role;
  end if;
  if to_regclass('public.modulos_instalados') is not null then
    revoke all on table public.modulos_instalados from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.modulos_instalados to service_role;
  end if;
  if to_regclass('public.system_update_runs') is not null then
    revoke all on table public.system_update_runs from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.system_update_runs to service_role;
  end if;
  if to_regclass('public.system_version') is not null then
    revoke all on table public.system_version from anon, authenticated, service_role;
    grant select, insert, update, delete on table public.system_version to service_role;
  end if;
end
$grants_9037$;

-- A chamada abaixo existe só na migration: no baseline, a chamada final das
-- travas de suporte vem logo depois deste bloco. Ela tira as `support_write_*`
-- das tabelas que deixaram de ser graváveis por `authenticated`.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;
