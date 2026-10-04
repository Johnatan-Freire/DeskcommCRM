---
impacto: nada_mudou
secao: corrigido
titulo: A atualização não devolve mais o privilégio de TRUNCATE ao papel anônimo em idempotency_keys
---
O `baseline.sql` é reaplicado inteiro em toda atualização. A concessão de `ALL` ao `anon` em `idempotency_keys` vinha do snapshot e a revogação de `TRUNCATE` — um privilégio que a RLS não alcança — ficava no apêndice: entre as duas pontas, e até a próxima atualização completa se a passada morresse no meio, o papel anônimo carregava o privilégio.

Agora a revogação acompanha a concessão, e o estado final não muda: o `anon` continua sem `TRUNCATE` e com os demais privilégios da concessão. Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
