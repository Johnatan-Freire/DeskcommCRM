---
impacto: nada_mudou
secao: corrigido
titulo: O agente de IA não responde duas vezes à mesma mensagem do cliente
---

Quando o cliente mandava uma mensagem enquanto o agente ainda terminava a resposta anterior, o turno seguinte já respondia à mensagem nova, e a mensagem nova, que tinha ganhado o próprio turno, era respondida de novo cerca de um minuto depois. O cliente recebia duas respostas quase iguais. Agora o agente confere, antes de responder, se outro turno já leu e respondeu à última mensagem do cliente, e nesse caso não responde de novo. Continua respondendo normalmente quando o turno anterior não chegou a ver a mensagem ou não enviou nada. Crédito: @Gervanno.
