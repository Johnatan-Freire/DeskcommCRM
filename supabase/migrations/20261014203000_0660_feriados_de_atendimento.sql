-- ---- feriados do atendimento humano (migration 0660) ----
-- Auditoria dos agentes (14/10/2026): a jornada dos atendentes é semanal
-- (`attendant_availability.schedule`) e não sabia de feriado — num feriado de
-- segunda o sistema dizia "a equipe volta às 8h" e passava a conversa para quem
-- não ia estar lá. A IA continua atendendo em feriado; o que muda é a equipe.
--
-- Um dia aqui = a equipe inteira da organização FORA naquele dia (no fuso de
-- cada jornada). A regra é aplicada em TypeScript pela mesma função pura que já
-- decide o horário (`isWithinSchedule`) e pela estimativa de reabertura — este
-- arquivo só guarda os dias.

create table if not exists public.feriados_de_atendimento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data date not null,
  descricao text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.feriados_de_atendimento add constraint feriados_de_atendimento_descricao_tamanho
    check (char_length(btrim(descricao)) between 1 and 120);
exception when duplicate_object then null; end $$;

create unique index if not exists feriados_de_atendimento_um_por_dia
  on public.feriados_de_atendimento (organization_id, data);

comment on table public.feriados_de_atendimento is
  'Dias em que a equipe humana inteira não atende (0660). Lido junto com a jornada de cada atendente: feriado = fora do expediente, e a estimativa de reabertura pula o dia.';

alter table public.feriados_de_atendimento enable row level security;

drop policy if exists "feriados_de_atendimento_select" on public.feriados_de_atendimento;
create policy "feriados_de_atendimento_select" on public.feriados_de_atendimento
  for select using (
    public.fn_is_platform_admin()
    or organization_id in (select public.fn_user_org_ids())
  );
drop policy if exists "feriados_de_atendimento_insert" on public.feriados_de_atendimento;
create policy "feriados_de_atendimento_insert" on public.feriados_de_atendimento
  for insert with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
drop policy if exists "feriados_de_atendimento_delete" on public.feriados_de_atendimento;
create policy "feriados_de_atendimento_delete" on public.feriados_de_atendimento
  for delete using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke update, truncate on public.feriados_de_atendimento from anon, authenticated;

notify pgrst, 'reload schema';
