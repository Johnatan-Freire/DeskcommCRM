-- ---- avisos temporários para os agentes de IA (migration 0658) ----
-- Auditoria dos agentes (14/10/2026): promoção de 7 dias, início de turma,
-- mudança temporária de horário, aviso institucional — não havia onde cadastrar
-- informação COM PRAZO. A "Memória da Org" é permanente: uma promoção posta lá
-- continuaria sendo oferecida depois de acabar.
--
-- A régua do prazo é do BANCO: o turno lê só o que `fn_avisos_vigentes` devolve
-- (publicado E agora entre início e fim). Aviso vencido não chega ao modelo por
-- construção — não depende de alguém lembrar de despublicar.
--
-- Escopo: `publico` (leads | alunos | todos) casa com o escopo do agente
-- (comercial → leads, acadêmico → alunos); `agente_ids` vazio = todos os agentes
-- daquele público. `cursos` é rótulo livre para o modelo ligar o aviso ao curso.
--
-- Histórico: toda criação e alteração vira uma linha APPEND-ONLY em
-- `avisos_temporarios_historico` (quem, quando, o retrato), gravada por gatilho —
-- o histórico não depende do handler lembrar de gravar.

create table if not exists public.avisos_temporarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo text not null,
  descricao text not null,
  inicio_em timestamptz not null,
  fim_em timestamptz not null,
  status text not null default 'rascunho',
  publico text not null default 'todos',
  agente_ids uuid[] not null default '{}',
  cursos text[] not null default '{}',
  prioridade smallint not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.avisos_temporarios add constraint avisos_temporarios_titulo_tamanho
    check (char_length(btrim(titulo)) between 1 and 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.avisos_temporarios add constraint avisos_temporarios_descricao_tamanho
    check (char_length(btrim(descricao)) between 1 and 2000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.avisos_temporarios add constraint avisos_temporarios_periodo
    check (fim_em > inicio_em);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.avisos_temporarios add constraint avisos_temporarios_status_valido
    check (status in ('rascunho', 'publicado', 'arquivado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.avisos_temporarios add constraint avisos_temporarios_publico_valido
    check (publico in ('leads', 'alunos', 'todos'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.avisos_temporarios add constraint avisos_temporarios_prioridade_faixa
    check (prioridade between 0 and 100);
exception when duplicate_object then null; end $$;

create index if not exists avisos_temporarios_vigencia
  on public.avisos_temporarios (organization_id, fim_em)
  where status = 'publicado';

comment on table public.avisos_temporarios is
  'Informação COM PRAZO que os agentes de IA usam como contexto (0658): só entra no turno publicada e dentro de [inicio_em, fim_em). Complementa — nunca substitui — o conhecimento permanente.';

create table if not exists public.avisos_temporarios_historico (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aviso_id uuid not null references public.avisos_temporarios(id) on delete cascade,
  operacao text not null check (operacao in ('criado', 'alterado')),
  autor_id uuid references auth.users(id) on delete set null,
  retrato jsonb not null,
  registrado_em timestamptz not null default now()
);

create index if not exists avisos_temporarios_historico_aviso
  on public.avisos_temporarios_historico (organization_id, aviso_id, registrado_em desc);

-- `updated_at` antes de gravar; o histórico DEPOIS (a linha do aviso precisa
-- existir para a FK do histórico).
create or replace function public.fn_avisos_temporarios_carimbo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.fn_avisos_temporarios_carimbo() from public, anon;
revoke execute on function public.fn_avisos_temporarios_carimbo() from authenticated, service_role;

create or replace function public.fn_avisos_temporarios_historico()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into avisos_temporarios_historico (organization_id, aviso_id, operacao, autor_id, retrato)
  values (
    new.organization_id, new.id,
    case when tg_op = 'INSERT' then 'criado' else 'alterado' end,
    coalesce(new.updated_by, new.created_by),
    jsonb_build_object(
      'titulo', new.titulo, 'descricao', new.descricao,
      'inicio_em', new.inicio_em, 'fim_em', new.fim_em,
      'status', new.status, 'publico', new.publico,
      'agente_ids', new.agente_ids, 'cursos', new.cursos, 'prioridade', new.prioridade));
  return null;
end;
$$;

revoke execute on function public.fn_avisos_temporarios_historico() from public, anon;
revoke execute on function public.fn_avisos_temporarios_historico() from authenticated, service_role;

drop trigger if exists trg_avisos_temporarios_carimbo on public.avisos_temporarios;
create trigger trg_avisos_temporarios_carimbo
  before update on public.avisos_temporarios
  for each row execute function public.fn_avisos_temporarios_carimbo();

drop trigger if exists trg_avisos_temporarios_historico on public.avisos_temporarios;
create trigger trg_avisos_temporarios_historico
  after insert or update on public.avisos_temporarios
  for each row execute function public.fn_avisos_temporarios_historico();

-- RLS: leitura para membros da organização; escrita a partir de manager.
alter table public.avisos_temporarios enable row level security;
alter table public.avisos_temporarios_historico enable row level security;

drop policy if exists "avisos_temporarios_select" on public.avisos_temporarios;
create policy "avisos_temporarios_select" on public.avisos_temporarios
  for select using (
    public.fn_is_platform_admin()
    or organization_id in (select public.fn_user_org_ids())
  );
drop policy if exists "avisos_temporarios_insert" on public.avisos_temporarios;
create policy "avisos_temporarios_insert" on public.avisos_temporarios
  for insert with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
drop policy if exists "avisos_temporarios_update" on public.avisos_temporarios;
create policy "avisos_temporarios_update" on public.avisos_temporarios
  for update using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  ) with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists "avisos_temporarios_historico_select" on public.avisos_temporarios_historico;
create policy "avisos_temporarios_historico_select" on public.avisos_temporarios_historico
  for select using (
    public.fn_is_platform_admin()
    or organization_id in (select public.fn_user_org_ids())
  );

-- Sem DELETE para ninguém da REST: aviso sai do ar por `arquivado`, e o histórico
-- é append-only (sem UPDATE/DELETE/TRUNCATE para os papéis do PostgREST).
revoke delete, truncate on public.avisos_temporarios from anon, authenticated, service_role;
revoke update, delete, truncate on public.avisos_temporarios_historico from anon, authenticated, service_role;
revoke insert on public.avisos_temporarios_historico from anon, authenticated;

-- O que o TURNO lê: só publicado e vigente, do público e do agente certos,
-- em ordem de prioridade. `p_agente` nulo = turno sem agente resolvido (só os
-- avisos sem restrição de agente).
create or replace function public.fn_avisos_vigentes(p_org uuid, p_publico text, p_agente uuid)
returns table (titulo text, descricao text, fim_em timestamptz, cursos text[], prioridade smallint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.titulo, a.descricao, a.fim_em, a.cursos, a.prioridade
    from avisos_temporarios a
   where a.organization_id = p_org
     and a.status = 'publicado'
     and now() >= a.inicio_em
     and now() < a.fim_em
     and (a.publico = 'todos' or a.publico = p_publico)
     and (cardinality(a.agente_ids) = 0 or (p_agente is not null and p_agente = any(a.agente_ids)))
   order by a.prioridade desc, a.fim_em asc, a.id
   limit 20;
$$;

revoke execute on function public.fn_avisos_vigentes(uuid, text, uuid) from public, anon;
revoke execute on function public.fn_avisos_vigentes(uuid, text, uuid) from authenticated;
grant  execute on function public.fn_avisos_vigentes(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
