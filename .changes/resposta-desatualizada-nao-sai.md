---
impacto: nada_mudou
secao: corrigido
titulo: O agente não envia a resposta que ficou desatualizada porque o cliente escreveu de novo enquanto ele pensava
---

Cliente que escreve em várias mensagens ("Oi", "Boa tarde", depois a pergunta) recebia duas ou mais respostas seguidas. A primeira saía desatualizada ("Como posso te ajudar?" com a pergunta já na conversa) porque o agente leu a conversa antes de a pergunta chegar e levou alguns segundos para escrever. Numa instalação real, 39% das respostas de um agente saíram a menos de 3 minutos de outra resposta ao mesmo cliente.

Agora, se chega mensagem nova do cliente enquanto a resposta está sendo escrita, ela não é enviada: o turno seguinte lê a conversa inteira e responde a tudo de uma vez. Para quem escreve sem parar não ficar sem resposta, a regra vale só enquanto a mensagem mais antiga sem resposta tiver menos de 2 minutos. Depois disso, a resposta sai mesmo assim. O tempo é ajustável por `RESPOSTA_OBSOLETA_TETO_MS`, e `0` desliga. Uma mensagem reentregue com atraso, com horário anterior ao da última que o agente leu, não segura a resposta: essa mensagem não abre turno próprio, e segurar a resposta deixaria o cliente sem nenhuma. Nenhuma configuração ou ação é necessária.

Contribuição de @automatikpg-ux (#1940).
