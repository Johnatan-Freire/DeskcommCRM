---
impacto: nada_mudou
secao: corrigido
titulo: O caminho de um arquivo enviado não sai mais da pasta da conversa por `..`
---

A conferência de que um arquivo pertence à conversa (`isMediaPathOwnedBy`) olhava só o começo do caminho, `{organização}/{conversa}/`. Um caminho como `{organização}/{conversa}/../../{outra}/arquivo` passava nessa conferência. Agora, depois do prefixo, só são aceitos nomes comuns: nada de `..`, `.`, segmento vazio ou barra invertida. A regra vale para o envio de mídia ao cliente e para o anexo da nota interna. Não foi medido se o Storage chegava a resolver o `..`; o conserto fecha a porta sem depender disso. Nada muda para quem opera a instalação.
