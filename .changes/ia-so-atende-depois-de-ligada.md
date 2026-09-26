---
impacto: nada_mudou
secao: corrigido
titulo: A IA só responde mensagem que chegou depois de ser ligada, e o follow-up de silêncio para de cobrar conversa encerrada por humano
---

O agente de IA passa a guardar o instante em que foi ligado: ao publicar, ao
despausar e ao trocar entre modo assistido e automático. Mensagem que aconteceu
antes desse instante (pelo horário real do WhatsApp, não pelo horário em que
chegou ao CRM) nunca dispara resposta automática. Isso vale para mensagem
recebida durante uma pausa, histórico sincronizado, fila atrasada e reenvio de
evento. Ao despausar, o agente atende só o que chegar dali em diante. Conversa
antiga continua podendo ser atendida quando o cliente manda mensagem nova, e o
agente recebe o histórico dela para dar continuidade.

O follow-up disparado por silêncio ("lead sem resposta") agora só reengaja
quando quem falou por último foi o atendimento automático, esperando o cliente.
Antes, ele mandava lembrete em conversa que um atendente encerrou pelo celular
("por nada, qualquer coisa estou à disposição"), em conversa com atendimento
humano em andamento e até com o agente pausado. Agora pausar o agente ou
desligar o fluxo para também os lembretes que já estavam agendados, e cada
silêncio recebe no máximo um reengajamento.

Mensagem automática que ficou mais de 30 minutos presa na fila porque o número
estava desconectado não é mais enviada sozinha na reconexão: ela fica marcada
como não enviada na conversa, para ninguém receber uma resposta fora de
contexto.

A primeira mensagem que o atendente manda pelo celular para abrir uma conversa
passa a fazer parte do que o agente lê antes de responder. Antes, ela ficava de
fora por uma diferença de 2 segundos entre o horário do WhatsApp e o do CRM.

Nenhuma configuração muda, e não há nada a fazer ao atualizar.
