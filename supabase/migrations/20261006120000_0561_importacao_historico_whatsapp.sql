-- ---- importação do histórico do WhatsApp: histórico é DADO, nunca evento (migration 0561) ----
--
-- Toda mensagem importada do histórico entra com `messages.origem = 'historico'`
-- e é arquiteturalmente INCAPAZ de iniciar efeito: resposta de IA, follow-up,
-- reengajamento, automação, campanha, notificação, webhook de saída ou envio.
--
-- Por que o corte mora no BANCO, e não só nos workers: todo INSERT inbound em
-- `messages` dispara, pelo gatilho `trg_messages_emit_event`, o evento
-- `message.received` — consumido por oito handlers, entre eles os webhooks de
-- saída do cliente (efeito EXTERNO) — e, por `trg_demanda_abre_no_inbound`,
-- abre ou reabre atendimento. Uma importação que confiasse só nos consumidores
-- teria disparado tudo isso para cada mensagem antiga.
--
-- As camadas, cada uma sem confiar na anterior:
--   1. gatilhos de `messages` ignoram `origem <> 'ao_vivo'` (nem evento, nem
--      atendimento, nem trava, nem revisão de resposta);
--   2. `fn_service_inbound` e `fn_ia_pode_responder_mensagem` recusam de novo;
--   3. a importação só aceita mensagem ANTERIOR à primeira conexão do número
--      (`channel_sessions.first_connected_at`) — sessão sem essa data não
--      importa nada (fail-closed) —, então todo histórico é mais velho que toda
--      mensagem ao vivo daquele número;
--   4. conversa que nasce pela importação nasce FECHADA: fora da Fila, do
--      rodízio (`fn_request_channel_routing` ignora conversa fechada) e de todo
--      sweep que exige conversa aberta;
--   5. a importação nunca grava status de envio (`queued`/`sending`), então
--      nenhum redrive nem recuperação de mensagem presa a alcança.
-- No código, o dreno de eventos e cada consumidor de mensagem recusam histórico
-- também (lib/channels/historico/), e o leitor do WAHA só tem métodos GET.
-- Vigiado por tests/invariants/importacao-historico-nao-dispara-nada.test.ts.

alter table public.messages add column if not exists origem text not null default 'ao_vivo';
alter table public.messages drop constraint if exists messages_origem_check;
alter table public.messages add constraint messages_origem_check
  check (origem in ('ao_vivo', 'historico'));
comment on column public.messages.origem is
  'ao_vivo = chegou pelo canal em tempo real; historico = importada do histórico do WhatsApp (0561). Histórico nunca dispara evento, atendimento, IA, follow-up, automação ou envio.';

-- O recibo da importação: um por pedido, idempotente, com progresso.
create table if not exists public.whatsapp_history_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text,
  janela_inicio timestamptz not null,
  janela_fim timestamptz not null,
  status text not null default 'pendente',
  motivo_falha text,
  conversas_total integer,
  conversas_processadas integer not null default 0,
  mensagens_importadas integer not null default 0,
  mensagens_duplicadas integer not null default 0,
  mensagens_fora_da_janela integer not null default 0,
  mensagens_descartadas integer not null default 0,
  contatos_criados integer not null default 0,
  conversas_criadas integer not null default 0,
  cursor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint whatsapp_history_imports_janela_check check (janela_inicio < janela_fim)
);
alter table public.whatsapp_history_imports drop constraint if exists whatsapp_history_imports_status_check;
alter table public.whatsapp_history_imports add constraint whatsapp_history_imports_status_check
  check (status in ('pendente', 'em_andamento', 'concluida', 'falhou', 'cancelada'));

-- Uma importação viva por número: pedir de novo enquanto roda devolve a mesma.
create unique index if not exists whatsapp_history_imports_uma_viva_por_sessao
  on public.whatsapp_history_imports (organization_id, channel_session_id)
  where status in ('pendente', 'em_andamento');
create unique index if not exists whatsapp_history_imports_idempotencia
  on public.whatsapp_history_imports (organization_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists whatsapp_history_imports_org_criada
  on public.whatsapp_history_imports (organization_id, created_at desc);

alter table public.whatsapp_history_imports enable row level security;
revoke all on public.whatsapp_history_imports from anon;
revoke insert, update, delete, truncate on public.whatsapp_history_imports from authenticated;
grant select on public.whatsapp_history_imports to authenticated;
grant all on public.whatsapp_history_imports to service_role;
-- Só LEITURA, e só para admin da organização. Quem escreve é o servidor
-- (service role), depois de `requireRole('admin')` e com a organização da sessão.
drop policy if exists "whatsapp_history_imports_admin_select" on public.whatsapp_history_imports;
create policy "whatsapp_history_imports_admin_select" on public.whatsapp_history_imports
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

drop trigger if exists trg_whatsapp_history_imports_updated_at on public.whatsapp_history_imports;
create trigger trg_whatsapp_history_imports_updated_at
  before update on public.whatsapp_history_imports
  for each row execute function public.fn_set_updated_at();

-- Gatilhos e decisões que reagem a mensagem: histórico não passa (camadas 1 e 2).

CREATE OR REPLACE FUNCTION "public"."fn_emit_message_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_event text;
begin
  -- 0561: mensagem importada do histórico é DADO, não evento — nada reage a ela.
  if new.origem = 'historico' then return new; end if;
  if new.direction = 'inbound' then
    v_event := 'message.received';
  else
    v_event := case new.status
                 when 'sending' then 'message.sending'
                 when 'sent' then 'message.sent'
                 when 'failed' then 'message.failed'
                 else 'message.outbound'
               end;
  end if;

  perform public.fn_log_event(
    new.organization_id, v_event,
    jsonb_build_object(
      'message_id', new.id, 'conversation_id', new.conversation_id,
      'contact_id', new.contact_id, 'direction', new.direction,
      'type', new.type, 'status', new.status, 'external_id', new.external_id,
      'channel_session_id', new.channel_session_id,
      'body_preview', "left"(new.body, 280)
    )
  );
  return new;
end$$;

create or replace function public.fn_demanda_abre_no_inbound()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- 0561: mensagem importada do histórico é DADO, não evento — nada reage a ela.
 if new.origem = 'historico' then return new; end if;
 perform public.fn_service_inbound(new.id); return new;
end; $$;

create or replace function public.fn_reply_inbound_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- 0561: mensagem importada do histórico é DADO, não evento — nada reage a ela.
 if new.origem = 'historico' then return new; end if;
 if new.direction='inbound' then
  update public.conversations set reply_context_revision=reply_context_revision+1 where organization_id=new.organization_id and id=new.conversation_id and contact_id=new.contact_id;
 end if;
 return new;
end;$$;

create or replace function public.fn_message_service_lock()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- 0561: mensagem importada do histórico é DADO, não evento — nada reage a ela.
 if new.origem = 'historico' then return new; end if;
 if new.direction='inbound' and new.contact_id is not null then perform public.fn_service_lock(new.organization_id,new.contact_id); end if;
 return new;
end; $$;

create or replace function public.fn_service_inbound(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
 m public.messages;
 c public.conversations;
 d public.demandas;
 reopened boolean;
 keep_owner boolean;
 pre_contact uuid;
begin
 select * into m from public.messages where id = p_message;
 -- 0561: mensagem importada do histórico é DADO, não evento — nada reage a ela.
 if not found or m.direction <> 'inbound' or m.service_revision is not null
    or m.origem is distinct from 'ao_vivo' then return; end if;
 select * into c from public.conversations where id = m.conversation_id;
 if not found or c.organization_id is distinct from m.organization_id
    or c.channel_session_id is distinct from m.channel_session_id
    or not exists(select 1 from public.channel_sessions where id=m.channel_session_id and organization_id=m.organization_id)
 then raise exception 'service_scope_mismatch' using errcode='23503'; end if;
 if c.is_group or coalesce(c.group_chat_id,'') like '%@g.us' then return; end if;
 if c.contact_id is distinct from m.contact_id
    or not exists(select 1 from public.contacts where id=m.contact_id and organization_id=m.organization_id)
 then raise exception 'service_scope_mismatch' using errcode='23503'; end if;
 pre_contact:=c.contact_id;
 perform public.fn_service_lock(c.organization_id,c.contact_id);
 select * into c from public.conversations where id=m.conversation_id and organization_id=m.organization_id for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='40001'; end if;
 if m.sent_at <= c.service_closed_at then return; end if;
 reopened := c.status in ('closed','resolved','archived');
 -- Só quando a empresa ligou "a conversa fica com quem atendeu". O caminho é o
 -- de lib/schemas/routing.ts, e só o booleano true liga: chave ausente ou com
 -- outro valor = o comportamento de sempre (volta para a fila).
 keep_owner := reopened and c.assigned_to_user_id is not null
   and coalesce((select o.settings->'routing'->'conversation_stays_with_attendant' = 'true'::jsonb
                   from public.organizations o where o.id = c.organization_id), false)
   and coalesce(public.fn_member_role_in_org(c.assigned_to_user_id,c.organization_id),'none')
     in ('agent','manager','admin');
 if not reopened then
   select x.* into d from public.demandas x join public.demanda_conversas dc on dc.demanda_id=x.id
    where x.id=c.current_demanda_id and x.organization_id=c.organization_id and x.contact_id=c.contact_id
      and dc.organization_id=c.organization_id and dc.conversation_id=c.id
      and dc.service_revision=c.service_revision and x.fechada_em is null;
 end if;
 if d.id is null then
   insert into public.demandas
     (organization_id,contact_id,aberta_em,origem,estado,dono_kind,dono_user_id,proximo_passo)
    values(c.organization_id,c.contact_id,m.sent_at,'inbound','aberta',
      case when keep_owner then 'humano' else 'ia' end,
      case when keep_owner then c.assigned_to_user_id else null end,
      'Responder à nova mensagem do cliente') returning * into d;
 end if;
 if reopened then
   update public.conversations set
     status=case when keep_owner then 'claimed' else 'open' end,
     status_changed_at=clock_timestamp(),
     service_revision=service_revision+1,service_started_at=m.sent_at,
     assigned_to_user_id=case when keep_owner then c.assigned_to_user_id else null end,
     -- O relógio do episódio NOVO, não o do encerrado: o prazo de devolução
     -- automática à IA (handoff_return_after_minutes) conta a partir do
     -- último sinal humano, e assigned_at é um deles. Guardar o do episódio
     -- antigo devolveria a conversa à IA no primeiro tick do cron.
     assigned_at=case when keep_owner then clock_timestamp() else null end,
     assignee_kind=case when keep_owner then 'user' else null end,
     bot_silenced_until=case when keep_owner then 'infinity'::timestamptz else c.bot_silenced_until end,
     active_ai_agent_id=null,
     current_demanda_id=d.id
    where id=c.id and organization_id=c.organization_id returning * into c;
 else
   update public.conversations set
     service_revision=service_revision+case when current_demanda_id is not null and current_demanda_id<>d.id then 1 else 0 end,
     service_started_at=case when current_demanda_id is not null and current_demanda_id<>d.id then m.sent_at else coalesce(service_started_at,m.sent_at) end,
     current_demanda_id=d.id
    where id=c.id and organization_id=c.organization_id returning * into c;
 end if;
 insert into public.demanda_conversas(organization_id,demanda_id,conversation_id,service_revision)
  values(c.organization_id,d.id,c.id,c.service_revision) on conflict(demanda_id,conversation_id)
  do update set service_revision=excluded.service_revision;
 update public.messages set service_revision=c.service_revision,demanda_id=d.id,demanda_revision=d.revision
  where id=m.id and organization_id=c.organization_id;
end; $$;

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
  select direction, sent_at, channel_session_id, contact_id, origem into m
    from messages where organization_id = p_org and id = p_message;
  if not found then return 'mensagem_desconhecida'; end if;
  -- 0561: histórico importado nunca é respondido; origem desconhecida, também não.
  if m.origem is distinct from 'ao_vivo' then return 'mensagem_historica'; end if;
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

-- Importa UM chat: contato, conversa (nova nasce FECHADA) e um lote de mensagens,
-- todas com `origem = 'historico'`. Só o servidor chama (service role), depois
-- de o leitor do WAHA — que só tem GET — trazer o lote.
--
-- p_contato:   {kind: 'phone'|'lid', phone, lid, chat_id, notify_name}
-- p_mensagens: [{external_id, from_me, type, body, sent_at, has_media, media_mime, raw_type}]
--
-- Recusa, sem criar nada, o que não é histórico de verdade ou não pode voltar:
--   - mensagem FORA da janela pedida ou a partir da primeira conexão do número;
--   - chat de contato ANONIMIZADO (LGPD): pelo contato resolvido, ou por
--     mensagem ao vivo de contato anonimizado com este chat id no external_id
--     — sem isto a importação ressuscitaria o histórico de quem pediu exclusão.
-- Deduplica pelas duas grafias do id do NOWEB (completa e "nua"), por
-- NOT EXISTS: a unicidade de `messages` é DEFERRABLE, e ON CONFLICT não a usa.
create or replace function public.fn_importar_conversa_historica(
  p_import uuid, p_contato jsonb, p_mensagens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  imp public.whatsapp_history_imports;
  corte timestamptz;
  fim timestamptz;
  v_kind text := p_contato->>'kind';
  v_chat text := nullif(p_contato->>'chat_id', '');
  v_contact uuid;
  v_anon boolean;
  v_contato_novo boolean := false;
  v_conv uuid;
  v_conv_nova boolean := false;
  v_validas jsonb;
  n_total int;
  n_desc int;
  n_fora int;
  n_validas int;
  n_ins int := 0;
  v_ultima timestamptz;
  v_preview text;
begin
  select * into imp from public.whatsapp_history_imports where id = p_import for update;
  if not found then raise exception 'importacao_desconhecida' using errcode = 'P0002'; end if;
  if imp.status <> 'em_andamento' then
    raise exception 'importacao_nao_esta_em_andamento' using errcode = '55000';
  end if;
  select first_connected_at into corte from public.channel_sessions
   where id = imp.channel_session_id and organization_id = imp.organization_id;
  if corte is null then raise exception 'sessao_sem_primeira_conexao' using errcode = '55000'; end if;
  if jsonb_typeof(p_mensagens) is distinct from 'array' then
    raise exception 'mensagens_invalidas' using errcode = '22023';
  end if;
  if v_kind is null or v_kind not in ('phone', 'lid') or v_chat is null then
    raise exception 'contato_invalido' using errcode = '22023';
  end if;
  fim := least(imp.janela_fim, corte);
  n_total := jsonb_array_length(p_mensagens);

  with c as (
    select e,
           (e->>'external_id') is not null and length(e->>'external_id') between 1 and 200
           and (e->>'sent_at') is not null
           and (e->>'type') in ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact')
           and (nullif(btrim(coalesce(e->>'body', '')), '') is not null
                or coalesce((e->>'has_media')::boolean, false)) as ok
      from jsonb_array_elements(p_mensagens) e
  ), j as (
    select e, ok, ok and (e->>'sent_at')::timestamptz >= imp.janela_inicio
                     and (e->>'sent_at')::timestamptz < fim as dentro
      from c
  )
  select count(*) filter (where not ok),
         count(*) filter (where ok and not dentro),
         coalesce(jsonb_agg(e) filter (where dentro), '[]'::jsonb)
    into n_desc, n_fora, v_validas
    from j;
  n_validas := jsonb_array_length(v_validas);

  if n_validas > 0 then
    -- LGPD, antes de criar qualquer coisa: o chat é de alguém anonimizado?
    if exists (
      select 1 from public.messages m
        join public.contacts ct on ct.id = m.contact_id and ct.organization_id = m.organization_id
       where m.organization_id = imp.organization_id and ct.is_anonymized
         and m.external_id like '%\_' || replace(replace(replace(v_chat, '\', '\\'), '_', '\_'), '%', '\%') || '\_%'
    ) then
      n_desc := n_desc + n_validas; n_validas := 0;
    end if;
  end if;

  if n_validas > 0 then
    v_contact := public.fn_upsert_wa_contact(imp.organization_id, v_kind,
      nullif(p_contato->>'phone', ''), nullif(p_contato->>'lid', ''), v_chat,
      nullif(p_contato->>'notify_name', ''));
    if v_contact is null then raise exception 'contato_nao_resolvido' using errcode = '22023'; end if;
    select is_anonymized, created_at = now() into v_anon, v_contato_novo
      from public.contacts where id = v_contact and organization_id = imp.organization_id;
    if coalesce(v_anon, true) then
      n_desc := n_desc + n_validas; n_validas := 0;
    end if;
  end if;

  if n_validas > 0 then
    if v_contato_novo then
      update public.contacts
         set source_metadata = source_metadata || jsonb_build_object('historico_import_id', imp.id)
       where id = v_contact and organization_id = imp.organization_id;
    end if;

    select max((e->>'sent_at')::timestamptz) into v_ultima from jsonb_array_elements(v_validas) e;
    select left(coalesce(nullif(btrim(e->>'body'), ''), '[mídia]'), 280) into v_preview
      from jsonb_array_elements(v_validas) e order by (e->>'sent_at')::timestamptz desc limit 1;

    select id into v_conv from public.conversations
     where organization_id = imp.organization_id and contact_id = v_contact
       and channel_session_id = imp.channel_session_id and is_group = false;
    if v_conv is null then
      -- Nasce FECHADA: fora da Fila e do rodízio (fn_request_channel_routing
      -- ignora conversa fechada), sem não lida, sem atendimento.
      insert into public.conversations (organization_id, contact_id, channel_session_id, channel,
          status, is_group, unread_count_for_assignee, metadata, last_message_at, last_message_preview)
      values (imp.organization_id, v_contact, imp.channel_session_id, 'whatsapp',
          'closed', false, 0,
          jsonb_build_object('origem', 'historico', 'historico_import_id', imp.id),
          v_ultima, v_preview)
      on conflict (organization_id, contact_id, channel_session_id) where is_group = false do nothing
      returning id into v_conv;
      if v_conv is null then
        select id into v_conv from public.conversations
         where organization_id = imp.organization_id and contact_id = v_contact
           and channel_session_id = imp.channel_session_id and is_group = false;
      else
        v_conv_nova := true;
      end if;
    end if;

    with c as (
      select distinct on (e->>'external_id')
             e->>'external_id' as completo,
             regexp_replace(e->>'external_id', '^.*_', '') as nu,
             coalesce((e->>'from_me')::boolean, false) as from_me,
             e
        from jsonb_array_elements(v_validas) e
       order by e->>'external_id'
    )
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id,
        external_id, type, direction, status, body, media_mime, sent_via, sent_at,
        delivered_at, metadata, origem)
    select imp.organization_id, v_conv, imp.channel_session_id, v_contact,
           -- a grafia que o caminho AO VIVO grava para cada direção
           case when c.from_me then c.nu else c.completo end,
           c.e->>'type',
           case when c.from_me then 'outbound' else 'inbound' end,
           -- nunca queued/sending: nada de redrive nem de recuperação de presa
           case when c.from_me then 'sent' else 'received' end,
           nullif(btrim(c.e->>'body'), ''),
           nullif(c.e->>'media_mime', ''),
           'external_device',
           (c.e->>'sent_at')::timestamptz,
           (c.e->>'sent_at')::timestamptz,
           jsonb_build_object('origem', 'historico', 'historico_import_id', imp.id,
             'raw_type', c.e->>'raw_type',
             'midia_nao_importada', coalesce((c.e->>'has_media')::boolean, false)),
           'historico'
      from c
     where not exists (
       select 1 from public.messages m
        where m.organization_id = imp.organization_id
          and m.external_id in (c.completo, c.nu));
    get diagnostics n_ins = row_count;
  end if;

  update public.whatsapp_history_imports set
    mensagens_importadas = mensagens_importadas + n_ins,
    mensagens_duplicadas = mensagens_duplicadas + (n_validas - n_ins),
    mensagens_fora_da_janela = mensagens_fora_da_janela + n_fora,
    mensagens_descartadas = mensagens_descartadas + n_desc,
    contatos_criados = contatos_criados + case when v_contato_novo and n_validas > 0 then 1 else 0 end,
    conversas_criadas = conversas_criadas + case when v_conv_nova then 1 else 0 end
  where id = imp.id;

  return jsonb_build_object('recebidas', n_total, 'importadas', n_ins,
    'duplicadas', n_validas - n_ins, 'fora_da_janela', n_fora, 'descartadas', n_desc,
    'contato_criado', v_contato_novo and n_validas > 0, 'conversa_criada', v_conv_nova);
end;
$$;

revoke execute on function public.fn_importar_conversa_historica(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.fn_importar_conversa_historica(uuid, jsonb, jsonb) to service_role;
