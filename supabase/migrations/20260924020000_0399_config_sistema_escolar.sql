-- 0399: configuração por organização da integração com o sistema escolar
-- (Laravel externo, API própria em /api/deskcomm/*) — usado pelos agentes
-- "Alunos" (busca aluno por telefone: matrícula, notas, frequência,
-- financeiro-status) e "Interessados" (catálogo de cursos/pacotes públicos).
--
-- Um-para-um por organização (chave primária é organization_id): hoje só a
-- Capital Code usa, mas é DESENHADO por organização desde o início — o
-- worker (lib/agent-engine) só oferece as tools ao turno quando a org TEM
-- linha aqui (mesmo padrão de `search_knowledge`, gated por
-- `agentConfig?.activeKbVersionId == null`); numa instalação de outro nicho
-- (e-commerce, clínica) a tabela fica vazia e as tools nunca aparecem.
--
-- Chave criptografada em repouso com o MESMO esquema AES-256-GCM de
-- `ai_provider_credentials` (lib/crypto/aes_gcm.ts, chave em
-- AI_CRED_AES_KEY) — reaproveitado, não duplicado: são três colunas
-- (ciphertext/iv/tag) com o mesmo formato, decifradas só no servidor
-- (service_role/admin client), nunca por PostgREST.
--
-- Tela de configuração (settings/tenant/sistema-escolar) sempre lê e escreve
-- pelo admin client no servidor (organization_id resolvido do JWT, nunca do
-- body), então o SELECT de `authenticated` fica revogado desde o início —
-- nenhum caminho de browser precisa ler api_key_encrypted/iv/tag.
create table if not exists public.org_sistema_escolar_config (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  base_url text not null,
  api_key_encrypted bytea not null,
  api_key_iv bytea not null,
  api_key_tag bytea not null,
  api_key_last4 text not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_sistema_escolar_config enable row level security;

drop trigger if exists trg_org_sistema_escolar_config_updated_at on public.org_sistema_escolar_config;
create trigger trg_org_sistema_escolar_config_updated_at
  before update on public.org_sistema_escolar_config
  for each row execute function public.fn_set_updated_at();

drop policy if exists tenant_isolation_org_sistema_escolar_config_write on public.org_sistema_escolar_config;
create policy tenant_isolation_org_sistema_escolar_config_write on public.org_sistema_escolar_config
  for all using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  );

revoke select on public.org_sistema_escolar_config from authenticated, anon;

notify pgrst, 'reload schema';
