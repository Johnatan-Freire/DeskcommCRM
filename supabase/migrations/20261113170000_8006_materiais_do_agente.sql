-- manifest: **Materiais do agente: a equipe cadastra vídeos, imagens e PDFs e diz, em texto livre, em que situação cada um deve ser enviado; o agente de IA envia o material dentro da conversa quando o contexto pede.** Tabela `materiais_do_agente` (título, "quando enviar", tipo `video`/`imagem`/`documento`, caminho no bucket privado `agent-materials`, MIME, tamanho, `agente_ids` — vazio = todos os agentes — e `ativo`), com RLS por organização: membro lê, manager+ escreve pelo servidor. O bucket aceita MP4, JPEG, PNG e PDF até 16 MB (o teto de vídeo do WhatsApp). O agente vê os materiais ativos que lhe cabem num bloco do contexto e os envia por `send_message` com `material_id`; o arquivo é copiado para a pasta da conversa em `whatsapp-media` (some com a conversa na LGPD) e a mensagem guarda `metadata.material_id`, que impede reenviar o mesmo material na mesma conversa. Faixa 8xxx: número próprio do fork. Espelho no apêndice do `supabase/baseline.sql`; prova em `tests/invariants/materiais-do-agente.test.ts`.
--
-- 8006 — materiais do agente (vídeo, imagem e PDF enviados pela IA).

create table if not exists public.materiais_do_agente (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo text not null,
  quando_enviar text not null,
  tipo text not null,
  storage_path text not null,
  mime text not null,
  tamanho_bytes bigint not null,
  agente_ids uuid[] not null default '{}',
  ativo boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.materiais_do_agente drop constraint if exists materiais_do_agente_titulo_tamanho;
alter table public.materiais_do_agente add constraint materiais_do_agente_titulo_tamanho
  check (char_length(btrim(titulo)) between 1 and 120);
alter table public.materiais_do_agente drop constraint if exists materiais_do_agente_quando_enviar_tamanho;
alter table public.materiais_do_agente add constraint materiais_do_agente_quando_enviar_tamanho
  check (char_length(btrim(quando_enviar)) between 10 and 2000);
alter table public.materiais_do_agente drop constraint if exists materiais_do_agente_tipo_valido;
alter table public.materiais_do_agente add constraint materiais_do_agente_tipo_valido
  check (tipo in ('video', 'imagem', 'documento'));
alter table public.materiais_do_agente drop constraint if exists materiais_do_agente_tamanho_valido;
alter table public.materiais_do_agente add constraint materiais_do_agente_tamanho_valido
  check (tamanho_bytes > 0 and tamanho_bytes <= 16777216);
-- O arquivo é da própria organização: <organization_id>/<id do material>.<ext>.
alter table public.materiais_do_agente drop constraint if exists materiais_do_agente_caminho_da_org;
alter table public.materiais_do_agente add constraint materiais_do_agente_caminho_da_org
  check (storage_path = organization_id::text || '/' || id::text || '.' || split_part(storage_path, '.', 2)
         and split_part(storage_path, '.', 2) in ('mp4', 'jpg', 'png', 'pdf'));

create index if not exists idx_materiais_do_agente_org_ativo
  on public.materiais_do_agente (organization_id, ativo);

comment on table public.materiais_do_agente is
  'Vídeos, imagens e PDFs que os agentes de IA enviam na conversa (8006). `quando_enviar` é a instrução da equipe; o agente decide pelo contexto. Escrito só pelo servidor (app/api/v1/ai/materiais).';

drop trigger if exists trg_materiais_do_agente_updated_at on public.materiais_do_agente;
create trigger trg_materiais_do_agente_updated_at
  before update on public.materiais_do_agente
  for each row execute function public.fn_set_updated_at();

alter table public.materiais_do_agente enable row level security;

-- Membro lê; ninguém escreve pela sessão (quem grava é a rota, com service role,
-- depois de requireRole('manager')). Num bloco: o update.sh roda sem ON_ERROR_STOP.
do $materiais_policies$
begin
  drop policy if exists tenant_isolation_materiais_do_agente_select on public.materiais_do_agente;
  create policy tenant_isolation_materiais_do_agente_select on public.materiais_do_agente
    for select using (organization_id in (select public.fn_user_org_ids()));
end $materiais_policies$;

-- Desde 30/10/2026 a Supabase não concede privilégio automático em tabela nova.
revoke all on table public.materiais_do_agente from anon, authenticated, service_role;
grant select on table public.materiais_do_agente to authenticated;
grant select, insert, update, delete on table public.materiais_do_agente to service_role;

-- Bucket privado. 16 MB é o teto de vídeo do WhatsApp; os tipos são os que o
-- canal envia como vídeo, imagem e documento.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-materials', 'agent-materials', false, 16777216,
        array['video/mp4', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
