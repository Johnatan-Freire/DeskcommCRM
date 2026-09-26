-- 0403 — corte temporal de ATIVAÇÃO do agente: a IA só atende mensagem que
-- aconteceu DEPOIS de ela ter sido ligada.
--
-- O DEFEITO (medido em produção, 2026-09-26). O corte que existia era o de
-- CONEXÃO (0398, `channel_sessions.first_connected_at`): protege o histórico
-- que o WAHA sincroniza ao parear. Não havia corte nenhum de ATIVAÇÃO do
-- agente — nem na publicação, nem na despausa. E o gatilho de silêncio do
-- follow-up nem o de conexão aplicava: um fluxo "Lead sem resposta" só de texto
-- fixo (que não exige agente, `agent-followup-gate.ts`) disparou lembretes com o
-- agente PAUSADO e sem versão publicada, para conversas que um humano já tinha
-- encerrado ("Por nada ☺️", "Segue o link para pagamento") e para conversas com
-- o bot silenciado por handoff. O sweep mede "silêncio" só pelo último INBOUND
-- do lead — nunca por quem falou por último.
--
-- A FONTE DE VERDADE: `ai_agents.service_enabled_at` — "desde quando este
-- agente está autorizado a responder". Gravada por TRIGGER, nunca pela
-- aplicação: pausa/despausa/publicação/arquivamento têm seis escritores
-- diferentes (rotas REST, server actions, prospecção, admin de tenants), e um
-- corte que dependesse de cada um lembrar de carimbar a data seria o corte que
-- falha no sétimo. A régua de "no ar" é a MESMA de `lib/ai/agents/no-ar.ts`:
-- publicado ∧ não pausado ∧ não arquivado.
--
--   * passou de "fora do ar" para "no ar"  → now()   (publicar, despausar)
--   * trocou de modo (assistido↔automático) → now()   (começa a atender de outro jeito)
--   * continua no ar                        → preserva (republicar versão não reabre o passado;
--                                                        a aplicação não consegue empurrar a data)
--   * saiu do ar                            → NULL    (sem autorização)
--
-- A DECISÃO, CENTRALIZADA EM SQL (os dois transportes — `pg.Pool` do
-- agent-engine e `rpc` do Supabase — chamam a MESMA função):
--
--   fn_ia_pode_responder_mensagem(org, mensagem, agente?) → 'autorizado' | motivo
--     compara `messages.sent_at` (horário REAL do WhatsApp, não o da
--     persistência) contra a conexão do canal E a ativação do agente. Fronteira
--     inclusiva: mensagem às 10:00:00 com ativação às 10:00:00 é atendida.
--     FAIL-CLOSED: horário ausente, horário no futuro, ativação desconhecida,
--     nenhum agente no ar → não autoriza.
--
--   fn_silencio_pode_reengajar(org, conversa, para_inscrever) → 'autorizado' | motivo
--     o gatilho de silêncio só vale quando quem falou por último foi o
--     ATENDIMENTO AUTOMÁTICO (ai/automation) esperando o lead, sem humano no
--     meio, com conversa aberta, e o último inbound autorizado pela função
--     acima (logo: com agente no ar e depois da ativação dele).
--
--   fn_followup_pode_enviar(org, inscrição) → 'autorizado' | motivo
--     a mesma régua no INSTANTE do envio, para inscrições de silêncio — pausar o
--     agente ou desligar o fluxo passa a parar também as inscrições já vivas.
--
-- BACKFILL. Agente que já está no ar ao aplicar esta migration recebe como
-- ativação o evento REAL mais recente que se conhece dele: o `published_at` da
-- versão publicada ou a última despausa auditada (`ai_agent.updated` com
-- `unpaused`), o que for MAIS TARDE. Mais tarde é a direção segura: pode deixar
-- sem resposta uma mensagem que já estava na fila no instante da migration,
-- nunca responde mensagem de antes da ativação real. Sem nenhum dos dois, now().
--
-- Idempotente: `add column if not exists`, `create or replace`, `drop trigger
-- if exists`; o backfill só toca linha no ar com a coluna NULL.

alter table public.ai_agents
  add column if not exists service_enabled_at timestamptz;

comment on column public.ai_agents.service_enabled_at is
  'Desde quando este agente está autorizado a responder: instante em que ele entrou no ar pela última vez (publicado ∧ não pausado ∧ não arquivado) ou trocou de modo de operação. NULL = fora do ar. Gravada SÓ pelo trigger trg_ai_agents_inicio_do_atendimento — a aplicação não consegue movê-la. Mensagem com sent_at anterior a isto nunca dispara a IA (fn_ia_pode_responder_mensagem, migration 0403).';

create or replace function public.fn_marcar_inicio_do_atendimento()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  no_ar_agora boolean := new.published_version_id is not null
                         and new.paused_at is null and new.archived_at is null;
  estava_no_ar boolean := false;
begin
  if tg_op = 'UPDATE' then
    estava_no_ar := old.published_version_id is not null
                    and old.paused_at is null and old.archived_at is null;
  end if;

  if not no_ar_agora then
    new.service_enabled_at := null;
  elsif not estava_no_ar then
    new.service_enabled_at := now();
  elsif new.operation_mode is distinct from old.operation_mode then
    new.service_enabled_at := now();
  else
    -- Continua no ar: preserva. `coalesce` só existe para a linha que já estava
    -- no ar antes desta migration e ainda não passou pelo backfill.
    new.service_enabled_at := coalesce(old.service_enabled_at, now());
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_marcar_inicio_do_atendimento() from public, anon, authenticated;

drop trigger if exists trg_ai_agents_inicio_do_atendimento on public.ai_agents;
create trigger trg_ai_agents_inicio_do_atendimento
  before insert or update on public.ai_agents
  for each row execute function public.fn_marcar_inicio_do_atendimento();

-- Backfill: só linha no ar e ainda sem data. O trigger acima roda neste UPDATE
-- (continua no ar → coalesce(old NULL, valor novo)), e por isso o valor novo
-- precisa vir no SET — não em `now()` implícito.
update public.ai_agents a
   set service_enabled_at = coalesce(
         greatest(
           (select v.published_at from public.ai_agent_versions v
             where v.organization_id = a.organization_id and v.id = a.published_version_id),
           (select max(l.created_at) from public.api_audit_log l
             where l.organization_id = a.organization_id and l.resource_id = a.id
               and l.action = 'ai_agent.updated' and l.metadata->>'unpaused' = 'true')
         ),
         now())
 where a.published_version_id is not null and a.paused_at is null and a.archived_at is null
   and a.service_enabled_at is null;

-- ---- a decisão central ----

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
  no_ar int;
  depois int;
  sem_data int;
begin
  select direction, sent_at, channel_session_id into m
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

  if p_agent is not null then
    select a.service_enabled_at into ativado
      from ai_agents a
     where a.organization_id = p_org and a.id = p_agent
       and a.published_version_id is not null and a.paused_at is null and a.archived_at is null;
    if not found then return 'agente_fora_do_ar'; end if;
    if ativado is null then return 'ativacao_desconhecida'; end if;
    if m.sent_at < ativado then return 'anterior_a_ativacao'; end if;
    return 'autorizado';
  end if;

  -- Sem agente resolvido (drain, follow-up): QUALQUER agente no ar que possa
  -- atender este número — publicado na sessão ou alcançável pelo roteador
  -- ativo dela. O turno refaz a pergunta com o agente que de fato resolveu.
  select count(*),
         count(*) filter (where a.service_enabled_at is not null and a.service_enabled_at <= m.sent_at),
         count(*) filter (where a.service_enabled_at is null)
    into no_ar, depois, sem_data
    from ai_agents a
   where a.organization_id = p_org
     and a.published_version_id is not null and a.paused_at is null and a.archived_at is null
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
  select cv.status, cv.assignee_kind, cv.bot_silenced_until, cv.is_group,
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
  select e.conversation_id, p.status as pointer_status,
         p.trigger_config->>'kind' as gatilho
    into r
    from followup_enrollments e
    left join followup_flow_pointers p
      on p.id = e.pointer_id and p.organization_id = e.organization_id
   where e.organization_id = p_org and e.id = p_enrollment;
  if not found then return 'inscricao_desconhecida'; end if;
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
