---
impacto: nada_mudou
secao: corrigido
titulo: As conversas, o histórico e os pedidos numa conversa de atendimento também só alcançam o contato do turno
---

O conserto de #2158 escopou a busca e a ficha de contato; as outras leituras do atendimento
seguiram alcançando a organização inteira. `crm_list_conversations` devolvia as conversas de
todos os clientes da empresa com a prévia da última mensagem junto, `crm_get_conversation`
abria qualquer conversa pelo uuid, `crm_get_conversation_history` entregava o texto de ponta a
ponta de qualquer conversa e `crm_list_contact_orders` listava valor, entrega e rastreio de
qualquer contato — tudo filtrado por organização, sem vazamento entre empresas, mas tudo
indo para o lado errado dentro dela.

O contato da conversa agora também chega a essas quatro leituras como contexto de confiança
(`ctx.contatoDoTurno`, injetado pelo runtime — o modelo não escreve esse campo). Com ele, a
lista passa a devolver só as conversas desta conversa (e a paginação da varredura some junto),
a conversa e o histórico de quem não é o desta conversa são recusados com o motivo em texto,
na mesma forma que a escrita já devolvia — o histórico confere o dono da conversa antes de
ler as mensagens —, e os pedidos são recusados antes da consulta. Sem contato de turno —
rota HTTP, MCP externo — nada muda, e o Operador, que também recebe o contato do turno, fica
escopado.

Refs #2178

Contribuição de @webtecnica (#2182).
