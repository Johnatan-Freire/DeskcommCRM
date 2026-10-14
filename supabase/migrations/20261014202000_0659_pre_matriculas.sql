-- ---- pré-matrícula registrada pelo agente comercial (migration 0659) ----
-- Auditoria dos agentes (14/10/2026): quando o interessado quer se matricular, a
-- IA não tinha onde registrar o pedido — o "pergunte se quer seguir com a
-- matrícula" do prompt terminava em nada. Decisão da escola: dados mínimos pelo
-- WhatsApp = nome completo, e-mail, curso e turno de interesse, telefone. CPF e
-- documentos NUNCA pelo chat.
--
-- Quem escreve é o SERVIDOR (a tool do agente pelo motor; a equipe muda o status
-- pela API) — não há INSERT/DELETE pela REST. A IA nunca confirma matrícula, vaga
-- ou pagamento: `status` só vira `matriculado` pela mão da equipe.
--
-- Idempotência: uma pré-matrícula ABERTA por contato e curso (índice único
-- parcial) — o lead que confirma duas vezes não vira dois pedidos.
--
-- LGPD: o consentimento fica gravado (instante + o texto que a pessoa aceitou), e
-- a anonimização do contato redige nome, e-mail e telefone pela virada de
-- `is_anonymized` (mesmo desenho da 0210/0391); curso, turno, status e datas
-- ficam — são registro do negócio.

create table if not exists public.pre_matriculas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  agent_id uuid references public.ai_agents(id) on delete set null,
  nome_completo text not null,
  email text not null,
  telefone text not null,
  curso text not null,
  turno text not null,
  consentimento_em timestamptz not null,
  consentimento_texto text not null,
  status text not null default 'nova',
  origem text not null default 'agente_ia',
  atendida_por uuid references auth.users(id) on delete set null,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_nome_tamanho
    check (char_length(btrim(nome_completo)) between 3 and 160);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_email_formato
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(email) <= 254);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_telefone_tamanho
    check (char_length(btrim(telefone)) between 1 and 32);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_curso_tamanho
    check (char_length(btrim(curso)) between 1 and 160);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_turno_valido
    check (turno in ('manha', 'tarde', 'noite', 'sem_preferencia'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_status_valido
    check (status in ('nova', 'em_atendimento', 'matriculado', 'desistiu'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_origem_valida
    check (origem in ('agente_ia', 'equipe'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_matriculas add constraint pre_matriculas_observacao_tamanho
    check (observacao is null or char_length(observacao) <= 2000);
exception when duplicate_object then null; end $$;

create unique index if not exists pre_matriculas_uma_aberta_por_curso
  on public.pre_matriculas (organization_id, contact_id, lower(btrim(curso)))
  where status in ('nova', 'em_atendimento');
create index if not exists pre_matriculas_fila
  on public.pre_matriculas (organization_id, status, created_at desc);

comment on table public.pre_matriculas is
  'Pré-matrícula registrada pelo agente comercial com consentimento (0659). A IA nunca confirma matrícula: status matriculado é da equipe.';

create or replace function public.fn_pre_matriculas_carimbo()
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

revoke execute on function public.fn_pre_matriculas_carimbo() from public, anon, authenticated;
grant  execute on function public.fn_pre_matriculas_carimbo() to service_role;

drop trigger if exists trg_pre_matriculas_carimbo on public.pre_matriculas;
create trigger trg_pre_matriculas_carimbo
  before update on public.pre_matriculas
  for each row execute function public.fn_pre_matriculas_carimbo();

-- RLS: membro lê; agent+ atualiza (o consultor muda o status); ninguém insere ou
-- apaga pela REST.
alter table public.pre_matriculas enable row level security;

drop policy if exists "pre_matriculas_select" on public.pre_matriculas;
create policy "pre_matriculas_select" on public.pre_matriculas
  for select using (
    public.fn_is_platform_admin()
    or organization_id in (select public.fn_user_org_ids())
  );
drop policy if exists "pre_matriculas_update" on public.pre_matriculas;
create policy "pre_matriculas_update" on public.pre_matriculas
  for update using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'agent'))
  ) with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'agent'))
  );

revoke insert, delete, truncate on public.pre_matriculas from anon, authenticated;
revoke delete, truncate on public.pre_matriculas from service_role;

-- LGPD: a virada de is_anonymized redige o que é DA pessoa.
create or replace function public.fn_redigir_pre_matriculas_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.pre_matriculas
     set nome_completo = 'Cliente Anonimizado',
         email = 'anonimizado@anonimizado.invalid',
         telefone = 'anonimizado',
         observacao = null
   where organization_id = new.organization_id
     and contact_id = new.id;
  return new;
end;
$$;

revoke execute on function public.fn_redigir_pre_matriculas_ao_anonimizar() from public, anon, authenticated;
grant  execute on function public.fn_redigir_pre_matriculas_ao_anonimizar() to service_role;

drop trigger if exists trg_redigir_pre_matriculas_ao_anonimizar on public.contacts;
create trigger trg_redigir_pre_matriculas_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_redigir_pre_matriculas_ao_anonimizar();

notify pgrst, 'reload schema';
