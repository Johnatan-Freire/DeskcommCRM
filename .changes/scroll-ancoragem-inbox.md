---
impacto: nada_mudou
secao: alterado
titulo: Abrir uma conversa no Inbox ancora no final de forma instantânea em vez de rolar suave (#1590)
---

Ao abrir uma conversa, o operador via a tela rolar animada (`smooth`) desde o topo até a mensagem mais recente, o que causava atraso visual e sensação de lentidão em conversas com histórico longo. A primeira ancoragem agora acontece de forma instantânea (`auto`), mantendo o comportamento de rolagem suave apenas para novas mensagens que chegam após o carregamento inicial.

Contribuição de @webtecnica (#1590).
