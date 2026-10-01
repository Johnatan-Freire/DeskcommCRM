---
impacto: nada_mudou
secao: corrigido
titulo: A busca da caixa de entrada para de consultar o banco com um termo feito só de parênteses
---

Um termo como `()`, `((` ou `(a` passava pelo tamanho mínimo da busca da caixa de entrada: o parêntese contava como letra, mas na consulta vira curinga, e a busca casava todas as conversas. Era uma consulta cara que não filtrava nada. Agora o tamanho mínimo é medido sem os parênteses, com a mesma régua que a busca de contatos já usava. Um termo assim conta como curto: a tela mostra a lista sem filtro, como acontece com uma letra só, e quem chama a API recebe a recusa de termo curto em vez da lista inteira. Nenhuma configuração ou ação é necessária.

Contribuição de @webtecnica (#1934).
