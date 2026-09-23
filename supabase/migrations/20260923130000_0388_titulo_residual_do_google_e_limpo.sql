-- ─── O título residual do compromisso pessoal do Google deixa de existir no banco ───
--
-- A 0261 já fechou a LEITURA: `authenticated` perdeu SELECT de tabela em
-- `calendar_external_events` e ganhou de volta só a lista de colunas que
-- exclui `title`, e a view `calendar_selected_external_events` foi recriada
-- sem a coluna. O escritor do produto (`fn_google_calendar`, 0225) já grava
-- `title=null` desde a v1.17.0, tanto no INSERT quanto no `on conflict ...
-- do update`.
--
-- O que a 0261 deixou aberto, por escrito e de propósito (ver o cabeçalho
-- dela, seção "O que esta migration NÃO faz"): linhas sincronizadas por
-- versões do worker ANTERIORES à v1.17.0 ainda têm o `title` real como DADO
-- na coluna — só não é mais LEGÍVEL por nenhum login (a permissão fecha o
-- acesso, não apaga o valor). A própria 0261 chama isso de "decisão do dono,
-- sai em migration própria, não de carona num conserto de permissão".
--
-- Esta é essa migration própria: minimização de dado (doutrina DIRC do
-- CLAUDE.md — sem referenciador, não duplica/não guarda). Não muda RLS, não
-- muda GRANT, não muda a view — só apaga o que sobrou. Idempotente: uma
-- segunda aplicação não casa nenhuma linha.
update public.calendar_external_events
   set title = null
 where title is not null;
