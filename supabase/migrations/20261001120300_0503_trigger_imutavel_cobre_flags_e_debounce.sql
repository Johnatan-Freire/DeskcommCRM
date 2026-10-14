-- ═══ A trava de imutabilidade da versão publicada passa a cobrir as colunas
-- que ficaram de fora (0503, issue #2003 do upstream — ADAPTADA no fork) ═══
--
-- `fn_ai_agent_version_content_immutable` impede um UPDATE de conteúdo numa
-- versão que já não é `draft` (a camada da app devolve 409; esta é a segunda
-- cerca, defense-in-depth, aberta para a service key).
--
-- No upstream a 0503 acrescentava `proposal_ai_draft_enabled` e
-- `inbound_debounce_ms`. NESTE FORK:
--   * `proposal_ai_draft_enabled` NÃO entra: a coluna não existe aqui
--     (propostas comerciais não foram portadas) e citar `new.<coluna>`
--     inexistente faria TODO update de versão publicada falhar em execução;
--   * a lista parte da definição do FORK, que já protegia
--     `sistema_escolar_tool_ids`, `can_mark_won` e `can_mark_lost` (a versão
--     do upstream apagaria essas três da trava);
--   * entram `inbound_debounce_ms` (a janela de rajada, 0498) e as duas colunas
--     da política por etapa do fork (0404): `service_scope` e
--     `can_update_lead_state`. Sem elas, o escopo acadêmico/comercial de uma
--     versão PUBLICADA podia ser trocado no lugar, sem versão nova e sem trilha.
--     Nenhum código nem migration do fork atualiza essas colunas em versão
--     publicada (os agentes da escola nascem draft e são publicados).
--
-- Idempotente (`create or replace`, `drop trigger if exists` antes do create).

create or replace function fn_ai_agent_version_content_immutable() returns trigger
-- search_path fixo na PRÓPRIA definição: um create or replace sem a cláusula
-- apaga o alter function ... set search_path da 0507 (0521 no upstream).
language plpgsql set search_path = '' as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.sistema_escolar_tool_ids is distinct from old.sistema_escolar_tool_ids
    or new.can_mark_won           is distinct from old.can_mark_won
    or new.can_mark_lost          is distinct from old.can_mark_lost
    or new.service_scope          is distinct from old.service_scope
    or new.can_update_lead_state  is distinct from old.can_update_lead_state
    or new.inbound_debounce_ms    is distinct from old.inbound_debounce_ms
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();

notify pgrst, 'reload schema';
