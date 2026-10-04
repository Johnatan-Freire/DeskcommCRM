---
impacto: nada_mudou
secao: corrigido
titulo: A atualização para de devolver o TRUNCATE do log de auditoria ao papel de serviço, e anon/authenticated perdem o TRUNCATE em orçamentos de IA
---
O `baseline.sql` é reaplicado inteiro em toda atualização. Três pontas da mesma família ficaram de fora do #2257: o `service_role` recuperava `TRUNCATE` no log de auditoria entre a concessão do snapshot e o bloco da 0258 (mais de 20 mil linhas de janela, de pé até a próxima atualização completa se a passada morresse no meio); e `anon`/`authenticated` mantinham `TRUNCATE` em `ai_budgets` no estado final, porque a 0160 revogou só INSERT/UPDATE/DELETE.

Agora a revogação acompanha as concessões nos três casos, e o `TRUNCATE` de `ai_budgets` sai também do estado final para as duas chaves — ele não passa pela RLS e nenhum consumidor o usa (toda escrita da tabela é service role). Leitura e escrita legítimas seguem como estavam. Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
