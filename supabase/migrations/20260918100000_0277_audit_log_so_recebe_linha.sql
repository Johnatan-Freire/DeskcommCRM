-- 0277 — o audit log perde UPDATE, DELETE e TRUNCATE nos papéis do PostgREST
--
-- ─── O problema ─────────────────────────────────────────────────────────────
--
-- `CLAUDE.md` afirmava, sobre `api_audit_log`: "Audit é append-only, e isso é do
-- SCHEMA e não da prosa: nenhum papel tem GRANT de UPDATE/DELETE — nem
-- `service_role`". Num projeto Supabase de verdade isso é FALSO.
--
-- Todo projeto Supabase nasce com um default ACL de tabelas em `public`, gravado
-- pelo bootstrap do Supabase ANTES de qualquer SQL nosso:
--
--     select pg_get_userbyid(defaclrole), defaclobjtype, defaclacl
--       from pg_default_acl where defaclnamespace = 'public'::regnamespace;
--     postgres | r | {…,anon=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}
--
-- Então `api_audit_log` nasce com TODOS os privilégios para anon, authenticated
-- e service_role. O `GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN`
-- que o dump emite para esta tabela só ACRESCENTA; não retira o UPDATE e o
-- DELETE que o default ACL já deu. Medido em 2026-09-18 aplicando este baseline
-- num Postgres descartável com o default ACL do Supabase simulado (`pgvector/pgvector:pg17`
-- + `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES` antes do dump, como um
-- projeto Supabase real já tem antes de qualquer migration nossa rodar):
--
--     anon:DELETE,TRUNCATE,UPDATE
--     authenticated:DELETE,TRUNCATE,UPDATE
--     service_role:DELETE,TRUNCATE,UPDATE
--
-- ─── O que isso permitia ────────────────────────────────────────────────────
--
-- • `service_role` ignora RLS: com a service key, `DELETE /rest/v1/api_audit_log
--   ?id=eq.<x>` apagava UMA linha escolhida, e `PATCH` a reescrevia. É o pior
--   desenho para uma auditoria — adulteração seletiva, sem deixar lacuna visível.
-- • `anon`/`authenticated`: o GRANT existia, mas a RLS não tem policy de UPDATE
--   nem de DELETE, então a escrita casava zero linhas. A garantia ali era de
--   UMA camada só, não duas.
-- • `TRUNCATE`, nos três: não é emitido pelo PostgREST, mas esvazia a tabela
--   inteira sem passar por RLS nem por policy.
--
-- ─── Por que o gate não via ─────────────────────────────────────────────────
--
-- O prelude de `scripts/test-db.sh` (`scripts/selfhost-prelude.sql`) reproduz
-- roles/schemas/extensions para rodar o baseline num Postgres puro, mas não
-- reproduz o default ACL de TABELAS que um Supabase real já tem — só criamos
-- roles e concedemos privilégios pontuais a stubs. Num Postgres cru a tabela
-- nasce só com o que o dump concede, e a sonda de grants devolvia vazio medindo
-- um universo onde o defeito não existe. Achado ao triar o CHANGELOG do upstream
-- (melgarafael/DeskcommCRM v1.27.0), que teve o mesmo gap e o mesmo achado.
--
-- ─── Por que revogar não quebra ninguém ─────────────────────────────────────
--
-- Nenhum caminho do produto altera ou apaga linha desta tabela pelos papéis do
-- PostgREST. Para conferir na fonte:
--
--     grep -rnEi "(delete|update|truncate)\s+(from\s+|table\s+)?(public\.)?api_audit_log" \
--       lib app workers supabase/baseline.sql
--     grep -rn 'from("api_audit_log")' lib app workers scripts
--
-- O único apagamento é o `delete` de dentro de `fn_expurgar_auditoria_vencida`
-- (0167), `security definer` de dono `postgres`, que não depende destes grants.
-- As FKs `on delete set null` que apontam desta tabela para `organizations`,
-- `auth.users` e `api_tokens` também não: a ação referencial roda como o dono da
-- tabela referenciante.
--
-- `public` entra no revoke por completude: hoje ninguém concede privilégio de
-- tabela a PUBLIC aqui, mas um grant a PUBLIC seria herdado pelos três papéis.
-- O dono (`postgres`) continua podendo tudo — a garantia é sobre os papéis que
-- o PostgREST assume, nunca absoluta.
--
-- ─── Forma ──────────────────────────────────────────────────────────────────
--
-- `revoke` do que já não existe não é erro: idempotente por natureza, e o
-- `update.sh` de um clone reaplica à vontade. Portável em `psql` puro.

revoke update, delete, truncate on table public.api_audit_log
  from public, anon, authenticated, service_role;

comment on table public.api_audit_log is
  'L-10: Append-only para os papéis do PostgREST — anon, authenticated e service_role não têm UPDATE, DELETE nem TRUNCATE (migration 0277; o default ACL do Supabase concedia os três). O único apagamento é fn_expurgar_auditoria_vencida (0167), security definer com piso de 90 dias no corpo. Retencao default 5 anos, configuravel em AUDIT_LOG_RETENTION_DAYS.';

notify pgrst, 'reload schema';
