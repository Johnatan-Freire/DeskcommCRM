---
impacto: nada_mudou
secao: corrigido
titulo: A atualização não devolve mais INSERT/UPDATE/DELETE em orçamentos de IA nem TRUNCATE do log de auditoria às chaves anon e authenticated
---
O `baseline.sql` é reaplicado inteiro em toda atualização. Duas concessões do snapshot ao papel `anon` eram revogadas só no fim do arquivo: `INSERT/UPDATE/DELETE` em `ai_budgets` e `TRUNCATE` em `api_audit_log` (o privilégio que a RLS não alcança). Entre as duas pontas, e até a próxima atualização completa se a passada morresse no meio, a chave anônima carregava o privilégio.

Agora as revogações acompanham as concessões, e o estado final não muda: o `anon` segue sem o que era revogado e com o resto — a leitura escopada por política em `ai_budgets` e `SELECT`/`INSERT` no log de auditoria. Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
