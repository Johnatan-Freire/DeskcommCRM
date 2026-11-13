-- manifest: **Privilégios explícitos nas 5 tabelas próprias do fork (Capital Code), no molde da 9037.** `avisos_temporarios`, `avisos_temporarios_historico`, `feriados_de_atendimento`, `org_sistema_escolar_config` e `pre_matriculas` nasceram no apêndice só com `revoke` do que sobrava do default ACL da Supabase. Desde 30/10/2026 a Supabase não concede mais privilégio automático em tabela nova de `public`: numa instalação nova essas tabelas nasceriam inalcançáveis pela Data API, e o `revoke` não teria o que tirar. Cada uma passa a receber `revoke all` e o `grant` do tamanho do uso, medido pelas policies da própria tabela e pelos revokes que já existiam: `anon` sem nada; `authenticated` só com os comandos que têm policy permissiva; `service_role` com o que o servidor faz (o histórico de avisos segue append-only também para ele). Em produção, onde as tabelas já existem, o estado final é o mesmo que os revokes antigos deixavam. Faixa 8xxx: números próprios do fork, que o upstream não usa. Espelho no apêndice do `supabase/baseline.sql`, antes da VARREDURA anon; prova em `tests/invariants/grants-explicitos-das-tabelas-do-apendice.test.ts`.
--
-- 8001 — grants explícitos das tabelas do fork.
--
-- Tudo num bloco `do`: o `update.sh` roda sem transação única, e `revoke` e
-- `grant` em comandos soltos abririam uma janela de `permission denied` para o
-- app no ar. Cada par só roda se a tabela existe (banco antigo sem o módulo).

do $grants_8001$
begin
  -- Avisos temporários: policies de select, insert e update; delete nunca.
  if to_regclass('public.avisos_temporarios') is not null then
    revoke all on table public.avisos_temporarios from anon, authenticated, service_role;
    grant select, insert, update on table public.avisos_temporarios to authenticated, service_role;
  end if;
  -- Histórico dos avisos: append-only. A equipe só lê; quem grava é o servidor.
  if to_regclass('public.avisos_temporarios_historico') is not null then
    revoke all on table public.avisos_temporarios_historico from anon, authenticated, service_role;
    grant select on table public.avisos_temporarios_historico to authenticated;
    grant select, insert on table public.avisos_temporarios_historico to service_role;
  end if;
  -- Feriados de atendimento: policies de select, insert e delete; sem update.
  if to_regclass('public.feriados_de_atendimento') is not null then
    revoke all on table public.feriados_de_atendimento from anon, authenticated, service_role;
    grant select, insert, delete on table public.feriados_de_atendimento to authenticated;
    grant select, insert, update, delete on table public.feriados_de_atendimento to service_role;
  end if;
  -- Configuração do sistema escolar: a leitura (com o segredo) é só do
  -- servidor; a tela de admin grava pela policy de escrita.
  if to_regclass('public.org_sistema_escolar_config') is not null then
    revoke all on table public.org_sistema_escolar_config from anon, authenticated, service_role;
    grant insert, update, delete on table public.org_sistema_escolar_config to authenticated;
    grant select, insert, update, delete on table public.org_sistema_escolar_config to service_role;
  end if;
  -- Pré-matrículas: a equipe lê e atualiza; quem cria é o servidor; ninguém apaga.
  if to_regclass('public.pre_matriculas') is not null then
    revoke all on table public.pre_matriculas from anon, authenticated, service_role;
    grant select, update on table public.pre_matriculas to authenticated;
    grant select, insert, update on table public.pre_matriculas to service_role;
  end if;
end
$grants_8001$;
