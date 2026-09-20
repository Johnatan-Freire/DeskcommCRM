---
impacto: nada_mudou
secao: corrigido
titulo: A resposta da IA não aparece mais duplicada depois de o WhatsApp reconectar
---

Quando o WhatsApp caía e voltava, o watchdog de sessão reenviava sozinho as
respostas da IA que tinham ficado esperando (`queued`) — e a mesma frase podia
aparecer duas vezes na conversa. O reenvio automático era o único caminho que
não apagava a cópia criada pelo eco do WhatsApp (o que o envio normal já
fazia desde o mecanismo de `removerEcoDoProprioEnvio`). Agora ele apaga, do
mesmo jeito.

Quem usa o motor WEBJS tinha um problema pior no mesmo caminho: o eco grava o
`_serialized`, a mesma string que o envio devolve, o `UPDATE` esbarrava no
`unique (organization_id, external_id)`, e a recusa era tratada como erro
transiente — a mensagem ficava presa em `queued` e era reenviada ao cliente a
cada tick do watchdog. Agora esse conflito é reconhecido: a mensagem sai
`sent` mesmo quando o eco já ocupa o id, e o id correto é gravado assim que o
eco é removido.
