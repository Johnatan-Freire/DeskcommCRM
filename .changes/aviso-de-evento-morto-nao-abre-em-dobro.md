---
impacto: nada_mudou
secao: corrigido
titulo: O aviso de evento morto não abre mais em dobro quando dois drenos rodam juntos
---

O dreno que vaza eventos para a Central consultava "já existe um aviso aberto?" e só depois inseria — e o cron `event-log-drain` e o drain-loop do worker disparam os dois ao mesmo tempo. Os dois liam "não existe" antes de qualquer escrita, os dois inseriam, e o problema de verdade ficava com dois avisos idênticos na Central. Aviso repetido é aviso que ninguém abre.

O banco agora é quem segura a fila: um índice único parcial em `agent_inbox_items` (organização, kind e título, só enquanto o aviso está aberto) recusa a segunda linha, e os dois caminhos de escrita passam a tratar essa recusa como o que ela é — "o aviso já estava aberto", e não um erro do dreno. A chave leva o título porque o `event_dead` tem duas famílias que precisam conviver abertas na mesma organização (a da IA que parou de responder e a de mídia), e o predicado é parcial porque uma linha resolvida não pode segurar o slot: reabrir um aviso continua funcionando, e reabrir quando já existe um aberto idêntico volta com resposta clara em vez de erro interno.

Kinds diferentes, organizações diferentes e as duas famílias do `event_dead` seguem gravando normalmente, em paralelo.

Contribuição de @webtecnica (#1928).
