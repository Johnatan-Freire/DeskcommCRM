---
impacto: capacidade_nova
secao: adicionado
titulo: O envio de mensagem pela API aceita chave de idempotência e registra o atendente em nome de quem a integração enviou
---

Integrações que enviam mensagens pelo `POST /api/v1/messages` podem mandar o cabeçalho `Idempotency-Key` (um UUID): uma retentativa com a mesma chave devolve a mesma resposta sem enviar de novo, e a mesma chave com outro conteúdo é recusada. Um token com o novo escopo "Integração pode enviar em nome de um atendente" (marcado na tela de tokens por um administrador) pode informar `on_behalf_of_user_id`; a conversa passa a mostrar "Fulano · via {nome do token}" no lugar de "Sistema". Só atendentes ativos da mesma organização são aceitos. Nada muda para quem não usa esses campos, e não há ação para quem opera a VPS: a coluna nova chega pela atualização normal.

Contribuição de @webtecnica (#1676).
