-- ─── O nome do compromisso pessoal do Google deixa de ser gravado ─────────
--
-- `calendar_external_events` é o espelho, somente-leitura, do que já existe na
-- agenda do Google conectada por alguém da equipe. A policy de SELECT é
-- "leitura de todos" (organization_id in fn_user_org_ids()) DE PROPÓSITO — é
-- assim que a ocupação aparece na agenda de quem NÃO conectou o Google (ver
-- `lib/agenda/consulta.ts`). Mas o worker de sync gravava também o `title`
-- (`evento.summary` do Google) nessa mesma linha — e nenhuma tela ou rota
-- deste produto jamais leu esse campo. O resultado: qualquer pessoa da
-- organização, inclusive com papel `viewer`, conseguia ler pela API REST
-- (PostgREST, com o próprio login) o NOME de um compromisso PESSOAL de um
-- colega — consulta médica, entrevista, o que for —, sem que a pessoa tenha
-- pedido para expor isso a ninguém.
--
-- Achado ao triar o CHANGELOG do upstream (`melgarafael/DeskcommCRM`
-- v1.28.0), que teve o mesmo vazamento. A causa raiz lá era idêntica: campo
-- gravado sem consumidor nenhum. A correção deles foi de PERMISSÃO (fechar a
-- leitura mantendo o dado). Aqui a correção é na ORIGEM: o worker
-- (`app/api/v1/cron/agenda-google-sync/route.ts`) para de gravar o valor real
-- — grava sempre `null` —, porque não existe consumidor e não há por que
-- guardar dado sensível sem uso (doutrina DIRC do CLAUDE.md: sem
-- referenciador, não duplica). A ocupação (`starts_at`/`ends_at`/
-- `transparency`/`status`) continua exatamente como antes — é só o `title`
-- que some.
--
-- Este bloco limpa o que já estava gravado em clones que já rodaram versões
-- anteriores do worker. Idempotente: uma segunda aplicação não muda nada.
update public.calendar_external_events
   set title = null
 where title is not null;
