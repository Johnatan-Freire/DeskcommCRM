---
impacto: nada_mudou
secao: corrigido
titulo: O inbox não abre mais barra de rolagem lateral com texto longo na memória do contato
---

Um fato durável registrado em "Memória do contato" (painel lateral da conversa)
com uma URL ou chave longa, sem espaços, não tinha onde quebrar a linha: o texto
passava da largura do painel e abria uma barra de rolagem horizontal
**dentro do painel lateral**. Agora o texto do fato quebra em qualquer ponto e
cabe na coluna.

A coluna do CRM também ganhou `min-w-0`, igual à coluna da conversa, como
defesa uniforme. Um teste novo prende a quebra forçada em todo
`whitespace-pre-wrap` do inbox, no fato e nesse `min-w-0`.
Nenhuma tela mudou de estrutura e nenhuma configuração pede ação.

O #1802 (rolagem com `Shift + Scroll` na conversa) segue aberto: este conserto
não alcança aquele sintoma.

Refs #1802

Contribuição de @webtecnica (#1827).
