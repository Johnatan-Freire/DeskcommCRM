---
impacto: nada_mudou
secao: corrigido
titulo: O cron do scheduler que falha deixa de falhar em silêncio — o log do scheduler diz qual rota errou e o que conferir
---

Quando uma rodada de cron do `scheduler` falha (o caso clássico é o `sync-model-catalog` tomando 401 porque o segredo que o agendador manda não é o que o app enxerga, o defeito da #1109), a linha do crontab descartava a saída E o erro do `curl` (`>/dev/null 2>&1`), e o crond ignora o status de saída. O resultado era um cron quebrado sem sintoma nenhum em lugar nenhum: o catálogo ficava vazio e ninguém via um log.

Agora o `>/dev/null` fica só no corpo da resposta. O status continua no STDERR do `curl -fsS` (é o `-S` que o imprime) e, quando o comando falha, a linha imprime no STDERR qual rota falhou e o que conferir — os dois chegam ao `docker logs` do scheduler. Em rodada saudável nada muda: o `||` só dispara em falha.

Nada a fazer na instalação.

Contribuição de @webtecnica (refs #1109).
