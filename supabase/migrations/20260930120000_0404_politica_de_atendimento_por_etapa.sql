-- 0404 — POLÍTICA DE ATENDIMENTO POR ETAPA, TRAVA DE SAÍDA E ESCOPO DO AGENTE
--
-- ## Por que existe
--
-- Até aqui a única semântica que uma etapa carregava para o atendimento
-- automático era o `agent_stage_hint` (para ONDE a IA move o card) e o par
-- `is_won`/`is_lost` (desfecho comercial). Nada dizia QUEM pode atender um
-- contato por causa da etapa em que ele está. Medido no funil de uma escola
-- (2026-09-30): "Equipe" (professores, funcionários, quem pede a recepção),
-- "Desqualificado" (spam, duplicado) e "Alunos e responsáveis" precisam de
-- regras de atendimento que nenhum campo expressava — e expressá-las em prompt
-- é pedir ao modelo que se lembre da regra no turno atípico.
--
-- ## O que entra
--
--   crm_stages.service_policy  'comercial' | 'terminal' | 'humano' | 'academico'
--     comercial  → atendimento automático comercial; follow-up permitido (DEFAULT:
--                  toda etapa existente continua exatamente como era)
--     terminal   → nenhuma IA, nenhum follow-up (desistiu, desqualificado)
--     humano     → nenhuma IA, nenhum follow-up: só gente atende
--     academico  → só agente de escopo acadêmico; nenhum follow-up comercial
--   crm_stages.exit_locked     o card que entra NÃO sai (gatilho abaixo)
--   ai_agent_versions.service_scope          'comercial' | 'academico'
--   ai_agent_versions.can_update_lead_state  a tool update_lead_state é permitida?
--
-- A decisão continua morando nas funções SQL que já decidem "a IA pode
-- responder?" e "o follow-up pode sair?" — as mesmas que drain, turno, worker de
-- sentimento, varredura de silêncio e envio de follow-up já consultam. Nenhum
-- chamador novo precisa lembrar de perguntar.
--
-- ## A trava de saída é do BANCO, de propósito
--
-- "Nunca sair da etapa" tem pelo menos seis escritores (tela, API, MCP, IA,
-- automação, handoff). Uma checagem em cada um é a régua espalhada que já
-- falhou antes. O gatilho recusa QUALQUER UPDATE que mude stage_id/pipeline_id de
-- um lead cuja etapa atual tem exit_locked — só quem é dono do banco, fora do
-- PostgREST, consegue o reparo extraordinário (desabilitando o gatilho numa
-- transação própria). Isso é a "ação extraordinária separada", não o fluxo.
--
-- ## Funil sem etapa de ganho
--
-- Nada no schema exige etapa de ganho (os índices só impedem DUAS). A exigência
-- era do domínio TypeScript (`validarMarcacao`), relaxada no mesmo PR.

-- ── etapa ────────────────────────────────────────────────────────────────────
alter table public.crm_stages add column if not exists service_policy text not null default 'comercial';
alter table public.crm_stages add column if not exists exit_locked boolean not null default false;

alter table public.crm_stages drop constraint if exists crm_stages_service_policy_valida;
alter table public.crm_stages add constraint crm_stages_service_policy_valida
  check (service_policy in ('comercial', 'terminal', 'humano', 'academico'));

-- Etapa só-humana ou acadêmica não pode ser desfecho comercial: entrar nela
-- fecharia o lead como venda/perda (`fn_crm_lead_close_on_stage`).
alter table public.crm_stages drop constraint if exists crm_stages_politica_sem_desfecho;
alter table public.crm_stages add constraint crm_stages_politica_sem_desfecho
  check (service_policy not in ('humano', 'academico') or (not is_won and not is_lost));

-- ── versão do agente ─────────────────────────────────────────────────────────
alter table public.ai_agent_versions add column if not exists service_scope text not null default 'comercial';
alter table public.ai_agent_versions add column if not exists can_update_lead_state boolean not null default true;

alter table public.ai_agent_versions drop constraint if exists ai_agent_versions_service_scope_valido;
alter table public.ai_agent_versions add constraint ai_agent_versions_service_scope_valido
  check (service_scope in ('comercial', 'academico'));

-- ── trava de saída ───────────────────────────────────────────────────────────
create or replace function public.fn_crm_leads_trava_de_saida()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.stage_id is not distinct from old.stage_id
     and new.pipeline_id is not distinct from old.pipeline_id then
    return new;
  end if;
  if exists (select 1 from public.crm_stages s
              where s.id = old.stage_id and s.organization_id = old.organization_id
                and s.exit_locked) then
    raise exception using
      errcode = 'PT423',
      message = 'etapa_travada',
      detail  = 'O contato está numa etapa permanente e não pode ser movido para outra etapa.';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_crm_leads_trava_de_saida() from public, anon;
revoke execute on function public.fn_crm_leads_trava_de_saida() from authenticated;

drop trigger if exists trg_crm_leads_trava_de_saida on public.crm_leads;
create trigger trg_crm_leads_trava_de_saida
  before update of stage_id, pipeline_id on public.crm_leads
  for each row execute function public.fn_crm_leads_trava_de_saida();

-- ── a política que vale para um contato ──────────────────────────────────────
--
-- Um contato pode ter mais de um lead. Vale o lead ABERTO (um por demanda) —
-- entre abertos, o mais restritivo; sem lead aberto, o fechado mais recente
-- (quem desistiu e não voltou continua "terminal"). Quem volta ganha um lead
-- novo pela régua de nascimento, e aquele episódio recomeça comercial.
-- Sem lead nenhum: 'comercial', o comportamento de antes desta migration.
create or replace function public.fn_politica_de_atendimento_do_contato(p_org uuid, p_contact uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.service_policy
       from crm_leads l
       join crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
      where l.organization_id = p_org and l.contact_id = p_contact and l.status = 'open'
      order by case s.service_policy
                 when 'humano' then 0 when 'terminal' then 1 when 'academico' then 2 else 3 end,
               l.created_at desc, l.id desc
      limit 1),
    (select s.service_policy
       from crm_leads l
       join crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
      where l.organization_id = p_org and l.contact_id = p_contact
      order by coalesce(l.closed_at, l.updated_at, l.created_at) desc, l.id desc
      limit 1),
    'comercial');
$$;

revoke execute on function public.fn_politica_de_atendimento_do_contato(uuid, uuid) from public, anon;
revoke execute on function public.fn_politica_de_atendimento_do_contato(uuid, uuid) from authenticated;
grant  execute on function public.fn_politica_de_atendimento_do_contato(uuid, uuid) to service_role;

-- ── a decisão central, agora com a política da etapa ─────────────────────────
create or replace function public.fn_ia_pode_responder_mensagem(
  p_org uuid, p_message uuid, p_agent uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m record;
  conectado timestamptz;
  ativado timestamptz;
  escopo text;
  politica text;
  escopo_exigido text;
  no_ar int;
  depois int;
  sem_data int;
begin
  select direction, sent_at, channel_session_id, contact_id into m
    from messages where organization_id = p_org and id = p_message;
  if not found then return 'mensagem_desconhecida'; end if;
  if m.direction is distinct from 'inbound' then return 'nao_e_mensagem_do_contato'; end if;
  if m.sent_at is null then return 'horario_desconhecido'; end if;
  -- Relógio do celular/provider adiantado demais: não dá para afirmar que a
  -- mensagem é nova nem que é antiga. Fail-closed.
  if m.sent_at > now() + interval '10 minutes' then return 'horario_ambiguo'; end if;

  select first_connected_at into conectado
    from channel_sessions where organization_id = p_org and id = m.channel_session_id;
  if conectado is not null and m.sent_at < conectado then return 'anterior_a_conexao'; end if;

  -- A etapa do contato decide QUEM pode atender (0404). Antes do agente: uma
  -- etapa terminal ou só-humana não tem agente certo nenhum.
  politica := public.fn_politica_de_atendimento_do_contato(p_org, m.contact_id);
  if politica = 'terminal' then return 'etapa_sem_ia'; end if;
  if politica = 'humano' then return 'etapa_so_humano'; end if;
  escopo_exigido := case when politica = 'academico' then 'academico' else 'comercial' end;

  if p_agent is not null then
    select a.service_enabled_at, v.service_scope into ativado, escopo
      from ai_agents a
      left join ai_agent_versions v
        on v.id = a.published_version_id and v.organization_id = a.organization_id
     where a.organization_id = p_org and a.id = p_agent
       and a.published_version_id is not null and a.paused_at is null and a.archived_at is null;
    if not found then return 'agente_fora_do_ar'; end if;
    if coalesce(escopo, 'comercial') <> escopo_exigido then return 'agente_fora_do_escopo_da_etapa'; end if;
    if ativado is null then return 'ativacao_desconhecida'; end if;
    if m.sent_at < ativado then return 'anterior_a_ativacao'; end if;
    return 'autorizado';
  end if;

  -- Sem agente resolvido (drain, follow-up): QUALQUER agente no ar, do escopo
  -- que a etapa exige, que possa atender este número — publicado na sessão ou
  -- alcançável pelo roteador ativo dela. O turno refaz a pergunta com o agente
  -- que de fato resolveu.
  select count(*),
         count(*) filter (where a.service_enabled_at is not null and a.service_enabled_at <= m.sent_at),
         count(*) filter (where a.service_enabled_at is null)
    into no_ar, depois, sem_data
    from ai_agents a
   where a.organization_id = p_org
     and a.published_version_id is not null and a.paused_at is null and a.archived_at is null
     and exists (select 1 from ai_agent_versions vs
                  where vs.organization_id = p_org and vs.id = a.published_version_id
                    and coalesce(vs.service_scope, 'comercial') = escopo_exigido)
     and (
       exists (select 1 from ai_agent_versions v
                where v.organization_id = p_org and v.id = a.published_version_id
                  and v.status = 'published' and v.channel_session_id = m.channel_session_id)
       or exists (select 1 from ai_routers r
                   where r.organization_id = p_org and r.is_active
                     and r.channel_session_id = m.channel_session_id
                     and (r.fallback_agent_id = a.id
                          or exists (select 1 from ai_router_members rm
                                      where rm.router_id = r.id and rm.agent_id = a.id)))
     );
  if no_ar = 0 then return 'nenhum_agente_no_ar'; end if;
  if depois > 0 then return 'autorizado'; end if;
  if sem_data > 0 then return 'ativacao_desconhecida'; end if;
  return 'anterior_a_ativacao';
end;
$$;

revoke execute on function public.fn_ia_pode_responder_mensagem(uuid, uuid, uuid) from public, anon;
revoke execute on function public.fn_ia_pode_responder_mensagem(uuid, uuid, uuid) from authenticated;
grant  execute on function public.fn_ia_pode_responder_mensagem(uuid, uuid, uuid) to service_role;

create or replace function public.fn_silencio_pode_reengajar(
  p_org uuid, p_conversation uuid, p_para_inscrever boolean)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c record;
  ultima record;
  ultimo_inbound record;
begin
  select cv.status, cv.assignee_kind, cv.bot_silenced_until, cv.is_group, cv.contact_id,
         ct.force_human, ct.is_blocked
    into c
    from conversations cv
    join contacts ct on ct.id = cv.contact_id and ct.organization_id = cv.organization_id
   where cv.organization_id = p_org and cv.id = p_conversation;
  if not found then return 'conversa_desconhecida'; end if;
  if c.is_group then return 'grupo'; end if;
  if c.status in ('closed', 'resolved', 'archived') then return 'conversa_encerrada'; end if;
  if coalesce(c.is_blocked, false) then return 'contato_bloqueado'; end if;
  if coalesce(c.force_human, false) or c.assignee_kind = 'user'
     or (c.bot_silenced_until is not null and c.bot_silenced_until > now()) then
    return 'humano_atendendo';
  end if;
  -- Follow-up é COMERCIAL: só etapa de política comercial (0404). Desistiu,
  -- Desqualificado, Equipe e a etapa acadêmica ficam fora, por regra do banco.
  if public.fn_politica_de_atendimento_do_contato(p_org, c.contact_id) <> 'comercial' then
    return 'etapa_fora_do_follow_up';
  end if;

  select direction, sent_via into ultima
    from messages where organization_id = p_org and conversation_id = p_conversation
   order by sent_at desc, created_at desc, id desc limit 1;
  if not found then return 'conversa_sem_mensagens'; end if;
  -- O lead falou por último e ninguém respondeu: isso é a EMPRESA devendo
  -- resposta, não "lead sem resposta". Um lembrete aqui seria cobrar o cliente.
  if ultima.direction = 'inbound' then return 'contato_aguardando_resposta'; end if;
  -- Humano (celular, tela, API) falou por último: é ele quem conduz — inclusive
  -- quando encerrou a conversa com um "por nada" sem clicar em encerrar.
  if ultima.sent_via is null or ultima.sent_via not in ('ai', 'automation') then
    return 'humano_falou_por_ultimo';
  end if;

  select id, sent_at into ultimo_inbound
    from messages where organization_id = p_org and conversation_id = p_conversation
     and direction = 'inbound'
   order by sent_at desc, created_at desc, id desc limit 1;
  if not found then return 'contato_nunca_falou'; end if;

  -- Um reengajamento por silêncio: sem isto, o lembrete (sent_via automation)
  -- vira ele mesmo "o atendimento falou por último", e o lead que não responde
  -- seria reinscrito a cada varredura, para sempre.
  if p_para_inscrever and exists (
       select 1 from followup_enrollments e
        where e.organization_id = p_org and e.conversation_id = p_conversation
          and e.started_at >= ultimo_inbound.sent_at) then
    return 'ja_reengajado_neste_silencio';
  end if;

  return public.fn_ia_pode_responder_mensagem(p_org, ultimo_inbound.id, null);
end;
$$;

revoke execute on function public.fn_silencio_pode_reengajar(uuid, uuid, boolean) from public, anon;
revoke execute on function public.fn_silencio_pode_reengajar(uuid, uuid, boolean) from authenticated;
grant  execute on function public.fn_silencio_pode_reengajar(uuid, uuid, boolean) to service_role;

create or replace function public.fn_followup_pode_enviar(p_org uuid, p_enrollment uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select e.conversation_id, e.contact_id, p.status as pointer_status,
         p.trigger_config->>'kind' as gatilho
    into r
    from followup_enrollments e
    left join followup_flow_pointers p
      on p.id = e.pointer_id and p.organization_id = e.organization_id
   where e.organization_id = p_org and e.id = p_enrollment;
  if not found then return 'inscricao_desconhecida'; end if;
  -- Follow-up é comercial em QUALQUER gatilho (0404): nenhum fluxo — silêncio,
  -- manual, webhook, etapa — fala com contato de etapa não comercial.
  if r.contact_id is not null
     and public.fn_politica_de_atendimento_do_contato(p_org, r.contact_id) <> 'comercial' then
    return 'etapa_fora_do_follow_up';
  end if;
  -- A régua é do gatilho de SILÊNCIO. Manual/webhook são escolha explícita de
  -- quem inscreveu; os demais gatilhos seguem as regras que já tinham.
  if r.gatilho is distinct from 'silence' then return 'autorizado'; end if;
  if r.pointer_status is distinct from 'active' then return 'fluxo_desligado'; end if;
  if r.conversation_id is null then return 'conversa_desconhecida'; end if;
  return public.fn_silencio_pode_reengajar(p_org, r.conversation_id, false);
end;
$$;

revoke execute on function public.fn_followup_pode_enviar(uuid, uuid) from public, anon;
revoke execute on function public.fn_followup_pode_enviar(uuid, uuid) from authenticated;
grant  execute on function public.fn_followup_pode_enviar(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
