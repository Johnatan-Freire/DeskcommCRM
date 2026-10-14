-- ---- pausa global de follow-ups da organização (migration 0657) ----
-- Auditoria dos agentes de IA (14/10/2026): não havia como parar TODOS os
-- follow-ups de uma vez pela tela — só fluxo a fluxo e inscrição a inscrição.
--
-- PAUSAR CONGELA, NÃO PULA. A recusa no instante do envio (fn_followup_pode_enviar)
-- vira passo `skipped` e o fluxo segue adiante sem a mensagem — pausar por ali
-- perderia passos. Por isso a pausa age em três pontos:
--
--   1. o claim (fn_claim_due_followup_enrollments) não reivindica inscrição de
--      organização pausada: as vivas ficam paradas onde estavam e retomam ao
--      despausar, no mesmo nó;
--   2. inscrição criada DURANTE a pausa nasce `cancelled` com
--      cancel_reason='followups_pausados' (gatilho BEFORE INSERT): são sete os
--      caminhos que inscrevem (silêncio, lead, etapa, caso, retorno, presença,
--      manual) e um gatilho só alcança todos. Uma boas-vindas que "acorda" dias
--      depois é pior que nenhuma;
--   3. as duas funções de corte devolvem 'followups_pausados' primeiro — os
--      emissores tratam esse motivo como ADIAMENTO, não como passo pulado
--      (defesa para o turno que já estava em voo quando a pausa entrou).
--
-- Quem pausa/retoma e quando: colunas na própria organização + api_audit_log.

alter table public.organizations add column if not exists followups_pausados_em timestamptz;
alter table public.organizations add column if not exists followups_pausados_por uuid;

do $$ begin
  alter table public.organizations
    add constraint organizations_followups_pausados_por_fkey
    foreign key (followups_pausados_por) references auth.users(id) on delete set null;
exception when duplicate_object then null; end $$;

comment on column public.organizations.followups_pausados_em is
  'Pausa global de follow-ups (0657): preenchida = nenhum follow-up da organização anda, inscreve ou envia. Nula = normal.';
comment on column public.organizations.followups_pausados_por is
  'Quem ligou a pausa global de follow-ups (0657).';

-- (2) inscrição nascida durante a pausa
create or replace function public.fn_followup_inscricao_respeita_pausa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('active', 'waiting_reply', 'dormente')
     and exists (select 1 from organizations o
                  where o.id = new.organization_id and o.followups_pausados_em is not null) then
    new.status := 'cancelled';
    new.cancel_reason := 'followups_pausados';
    new.next_eval_at := null;
    new.completed_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_followup_inscricao_respeita_pausa() from public, anon;
revoke execute on function public.fn_followup_inscricao_respeita_pausa() from authenticated, service_role;

drop trigger if exists trg_followup_inscricao_respeita_pausa on public.followup_enrollments;
create trigger trg_followup_inscricao_respeita_pausa
  before insert on public.followup_enrollments
  for each row execute function public.fn_followup_inscricao_respeita_pausa();

-- (1) o claim não enxerga organização pausada
create or replace function fn_claim_due_followup_enrollments(p_limit int, p_lease_seconds int)
returns setof followup_enrollments
language sql
security definer
set search_path = public
as $$
  with orgs as (
    -- Sem a condição de claim aqui de propósito: o lateral abaixo a aplica, e uma
    -- organização cujos vencidos estão todos com lease apenas devolve zero linhas.
    -- Organização com follow-ups pausados (0657) não entra: as inscrições dela
    -- ficam paradas no nó em que estavam até a retomada.
    select distinct fe.organization_id
      from followup_enrollments fe
      join organizations o on o.id = fe.organization_id
     where fe.status in ('active','waiting_reply','dormente')
       and fe.next_eval_at <= now()
       and o.followups_pausados_em is null
  ),
  fila as (
    select f.id, f.next_eval_at, f.posicao_na_org
      from orgs
      cross join lateral (
        select d.id,
               d.next_eval_at,
               row_number() over (order by d.next_eval_at) as posicao_na_org
          from followup_enrollments d
         where d.organization_id = orgs.organization_id
           and d.status in ('active','waiting_reply','dormente')
           and d.next_eval_at <= now()
           and (d.claimed_until is null or d.claimed_until < now())
         order by d.next_eval_at
         limit p_limit
      ) f
  ),
  escolhidos as (
    -- O rodízio: posição 1 de todas as organizações, depois a 2 de todas, etc.
    -- Empate na mesma posição vai para quem esperou mais.
    select id from fila order by posicao_na_org, next_eval_at limit p_limit
  ),
  travados as (
    select e.id from followup_enrollments e
     where e.id in (select id from escolhidos)
     for update skip locked
  )
  update followup_enrollments e
     set claimed_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where e.id in (select id from travados)
     -- A condição de lease É REPETIDA AQUI, e não é redundante com a CTE `fila`
     -- (duas conexões simultâneas reclamariam as mesmas linhas — ver a 0145).
     and (e.claimed_until is null or e.claimed_until < now())
  returning e.*;
$$;

revoke execute on function fn_claim_due_followup_enrollments(int, int) from public, anon, authenticated;
grant execute on function fn_claim_due_followup_enrollments(int, int) to service_role;

-- (3) as funções de corte respondem a pausa primeiro
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
  -- 0657: pausa global de follow-ups vence todo o resto.
  if exists (select 1 from organizations o where o.id = p_org and o.followups_pausados_em is not null) then
    return 'followups_pausados';
  end if;

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
  -- 0657: pausa global de follow-ups vence todo o resto (os emissores ADIAM).
  if exists (select 1 from organizations o where o.id = p_org and o.followups_pausados_em is not null) then
    return 'followups_pausados';
  end if;
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
