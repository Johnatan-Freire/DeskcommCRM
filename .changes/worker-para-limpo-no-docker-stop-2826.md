---
impacto: nada_mudou
secao: corrigido
titulo: Parar ou atualizar o worker não o mata mais à força aos 5 segundos
---

Quando a VPS parava o worker (atualização, reinício ou `docker stop`), o processo era morto à força uns 5 segundos depois, mesmo sem nada para fazer. Se havia uma mensagem saindo nesse momento, ela podia chegar ao WhatsApp sem que o worker anotasse o envio: o sistema a mostrava como presa e depois como falha, embora tivesse saído. Agora o worker recebe o aviso de parada, para de começar trabalho novo e usa o tempo de parada para terminar o que estava em andamento. Nenhuma configuração nova, nenhum passo manual: a atualização leva a correção.

Contribuição de @webtecnica (#2826), a partir da issue #2823.
