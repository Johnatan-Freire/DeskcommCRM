-- 0401 — bloqueio de estados terminais (won/lost) por versão de agente.
--
-- `update_lead_state(stage:'won')` já move o card real hoje (agent_stage_hint,
-- migration 0084) sem NENHUMA verificação de pagamento — a auditoria do agente
-- comercial da Capital Code (fases 1-2.4, sessão local) achou três portas
-- igualmente desguarnecidas chegando no mesmo `is_won`: arrastar o card à mão,
-- a tool MCP `crm_close_demand`, e esta. `lost` tem o mesmo problema de
-- autorização e MAIS um bug real e independente: `crm_leads_lost_reason_required`
-- (CHECK) exige `lost_reason` preenchido, mas `sincronizaEstagioDoAgente` nunca
-- escrevia essa coluna — todo `lost` vindo de QUALQUER agente, em QUALQUER org,
-- falhava a gravação no CRM (`falha_de_escrita`) mesmo com o harness avançando.
-- Esta migration resolve só a AUTORIZAÇÃO; o fix do `lost_reason` está no
-- código (lib/leads/agent-stage-sync.ts), não no schema.
--
-- Default `true` preserva 100% do comportamento de toda versão já publicada —
-- ninguém perde capacidade que já usava. A direção segura para versão NOVA
-- ("nasce fechado", mesma doutrina de pipeline_ids/knowledge_source_ids/
-- sistema_escolar_tool_ids) fica no APLICATIVO: os pontos de INSERT passam a
-- escrever `false` explicitamente para agente novo — o DEFAULT sozinho não
-- bastaria (issue conhecida: campo sensível que só o SQL protege é campo que
-- alguém esquece de proteger no código).
--
-- Porte do fork DeskcommCRM (Capital Code), commit `bf7d647ca` — customização
-- exclusiva, sem equivalente no upstream. **Numerada `0401` (não `0282` do
-- fork)**: 0282 já está ocupado no upstream v1.47.0.

alter table ai_agent_versions
  add column if not exists can_mark_won boolean not null default true;

alter table ai_agent_versions
  add column if not exists can_mark_lost boolean not null default true;

comment on column ai_agent_versions.can_mark_won is
  'Se update_lead_state pode marcar stage=won. Fail-closed no chamador (verificarAutorizacaoTerminal) — ausência de agentConfig bloqueia. Default true = comportamento anterior preservado; agente NOVO nasce com false (aplicação, não SQL).';
comment on column ai_agent_versions.can_mark_lost is
  'Mesma proteção de can_mark_won, para stage=lost. lost também exige reason não vazio (lead-state.ts) antes de qualquer gravação.';

-- Conteúdo imutável (0050, reassentada pela 0400 com sistema_escolar_tool_ids)
-- precisa vigiar as duas colunas novas — sem isto, um UPDATE poderia trocar
-- can_mark_won/can_mark_lost numa versão já publicada por fora do fluxo
-- "conteúdo novo = versão draft nova".
create or replace function fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
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
