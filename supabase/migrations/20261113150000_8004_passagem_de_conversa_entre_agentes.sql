-- manifest: **Um agente de IA passa a conversa para outro agente do mesmo número (ferramenta `transfer_to_agent`), e a passagem vale até o atendimento ser encerrado.** Caso que motivou: o agente de Alunos não tinha como entregar ao Comercial o aluno que pergunta de outro curso, porque a etapa acadêmica do contato (0404) sempre escolhia o acadêmico. `conversations` ganha `agente_passado_id`/`agente_passado_em`; `fn_agente_passado_da_conversa` diz se a passagem ainda vale (conversa não encerrada desde a passagem, carimbo que o `trg_service_stamp_status` já grava em todo encerramento; agente publicado, não pausado nem arquivado); e `fn_ia_pode_responder_mensagem` passa a exigir o escopo do agente que recebeu a conversa, depois das etapas terminal e só-humana, que continuam vencendo. A trilha vem da 9064 do upstream (#3823/#3770): `ai_router_decisions.outcome` aceita `transferred`, e a tabela ganha `origem`, `agente_anterior_id`, `motivo` (vocabulário fechado) e `solicitado_por`; a trilha passa a ser escrita só pelo servidor (membros leem). Os follow-ups não mudam: continuam só para contato em etapa comercial. Faixa 8xxx: número próprio do fork. Espelho no apêndice do `supabase/baseline.sql`; prova em `tests/invariants/passagem-entre-agentes.test.ts`.
--
-- 8004 — passagem de conversa entre agentes de IA, adaptada à régua de etapa do fork.

-- ─── A trilha (9064 do upstream) ─────────────────────────────────────────────
-- `= any (array[...])` e não `in (...)`: a cerca
-- `tests/unit/desfecho-da-captacao-um-vocabulario-so.test.ts` acha o CHECK de
-- `webhook_lead_captures.outcome` pela última grafia `outcome` + `in (...)` do
-- baseline. O comentário fica acima do `drop`, que precisa estar colado no `add`
-- (`tests/unit/baseline-reaplicavel.test.ts`).
alter table public.ai_router_decisions
  drop constraint if exists ai_router_decisions_outcome_check;
alter table public.ai_router_decisions
  add constraint ai_router_decisions_outcome_check
  check (outcome = any (array['classified', 'sticky', 'reclassified', 'fallback', 'no_match', 'classifier_failed', 'transferred']));

alter table public.ai_router_decisions
  add column if not exists origem text not null default 'classificador';
alter table public.ai_router_decisions
  drop constraint if exists ai_router_decisions_origem_check;
alter table public.ai_router_decisions
  add constraint ai_router_decisions_origem_check
  check (origem in ('classificador', 'acao'));

alter table public.ai_router_decisions
  add column if not exists agente_anterior_id uuid references public.ai_agents(id) on delete set null;

alter table public.ai_router_decisions
  add column if not exists motivo text;
alter table public.ai_router_decisions
  drop constraint if exists ai_router_decisions_motivo_check;
alter table public.ai_router_decisions
  add constraint ai_router_decisions_motivo_check
  check (motivo is null or motivo in ('pedido_do_agente', 'pedido_do_operador', 'regra_de_automacao'));

alter table public.ai_router_decisions
  add column if not exists solicitado_por uuid;

-- A trilha é escrita só pelo servidor (o motor, pela conexão direta); os
-- membros da organização leem. `drop` e `create` no mesmo bloco: o `update.sh`
-- roda sem ON_ERROR_STOP.
do $trilha_do_roteador$
begin
  drop policy if exists tenant_isolation_ai_router_decisions_all on public.ai_router_decisions;
  drop policy if exists tenant_isolation_ai_router_decisions_select on public.ai_router_decisions;
  create policy tenant_isolation_ai_router_decisions_select on public.ai_router_decisions
    for select using (organization_id in (select public.fn_user_org_ids()));
end $trilha_do_roteador$;

-- ─── A passagem gravada na conversa ──────────────────────────────────────────
-- Coluna própria, e não `active_ai_agent_id`: aquela é o "sticky" do roteador,
-- gravado pelo turno a cada decisão de roteamento e zerado na reabertura. A
-- passagem é uma decisão explícita que vence a etapa do contato.
alter table public.conversations
  add column if not exists agente_passado_id uuid references public.ai_agents(id) on delete set null;
alter table public.conversations
  add column if not exists agente_passado_em timestamptz;

-- O agente a quem a conversa foi passada, se a passagem ainda vale; senão null.
-- Vale enquanto a conversa não foi encerrada DEPOIS dela (`service_closed_at`,
-- carimbado pelo `trg_service_stamp_status` em todo encerramento, por qualquer
-- caminho) e enquanto o agente está no ar. Reabrir a conversa começa um
-- atendimento novo, e a etapa volta a decidir.
create or replace function public.fn_agente_passado_da_conversa(p_org uuid, p_conversation uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.agente_passado_id
    from conversations c
    join ai_agents a on a.id = c.agente_passado_id and a.organization_id = c.organization_id
   where c.organization_id = p_org and c.id = p_conversation
     and c.agente_passado_em is not null
     and c.status not in ('closed', 'resolved', 'archived')
     and (c.service_closed_at is null or c.agente_passado_em > c.service_closed_at)
     and a.published_version_id is not null and a.paused_at is null and a.archived_at is null;
$$;
revoke execute on function public.fn_agente_passado_da_conversa(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_agente_passado_da_conversa(uuid, uuid) to service_role;

-- ─── Quem pode responder: a passagem entra depois das etapas sem IA ─────────
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
  passado uuid;
  escopo_passado text;
begin
  select direction, sent_at, channel_session_id, contact_id, conversation_id, origem into m
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

  -- 8004: a conversa PASSADA a outro agente (ferramenta `transfer_to_agent`)
  -- segue o escopo do agente que a recebeu, até o atendimento ser encerrado.
  -- Vem DEPOIS das etapas terminal/só-humana: a passagem troca de agente, nunca
  -- devolve à IA um contato que a equipe tirou dela.
  passado := public.fn_agente_passado_da_conversa(p_org, m.conversation_id);
  if passado is not null then
    select coalesce(v.service_scope, 'comercial') into escopo_passado
      from ai_agents a
      join ai_agent_versions v
        on v.id = a.published_version_id and v.organization_id = a.organization_id
     where a.organization_id = p_org and a.id = passado;
    escopo_exigido := coalesce(escopo_passado, escopo_exigido);
  end if;

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
