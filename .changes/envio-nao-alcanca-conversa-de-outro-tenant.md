---
impacto: nada_mudou
secao: corrigido
titulo: O envio de mensagem por agente de IA não alcança mais a conversa de outra empresa
---

`sendMessageHandler` é a porta de saída de toda mensagem outbound do produto,
e a consulta que localiza a conversa filtrava só pelo id — nunca pela
organização. Quem envia pela tela estava protegido pela permissão do banco
(RLS), mas o agente de IA fala com o banco por um caminho que ignora essa
permissão por desenho. Sem o filtro, um agente de uma empresa com o id de
conversa de outra gravaria e enviaria a mensagem pelo WhatsApp dela.

Agora a consulta também exige que a conversa pertença à organização de quem
está enviando. Envio pela tela continua funcionando exatamente como antes; o
caminho do agente de IA passa a recusar com "não encontrada" em vez de
alcançar a conversa errada.
