---
impacto: nada_mudou
secao: corrigido
titulo: A reunião remarcada para mais longe volta a receber o lembrete da data nova
---

Quando um lembrete já tinha saído e a reunião era remarcada para uma data mais distante, a data nova ficava sem esse lembrete, porque o sistema guardava apenas que ele já tinha sido enviado, sem dizer para qual data. Agora o lembrete volta a valer para a data nova e sai uma única vez, na hora certa.

Para não mandar duas mensagens em sequência, o lembrete só volta quando a hora dele na data nova fica a pelo menos metade do seu intervalo depois do último envio. Para o lembrete da véspera, isso quer dizer 12 horas: a reunião empurrada para o mesmo horário do dia seguinte recebe a véspera nova, e a reunião empurrada em 30 minutos logo depois de a véspera sair não recebe uma segunda. Remarcar para mais perto não reenvia nada, e o lembrete cuja hora já tinha passado no momento da remarcação continua não saindo. Reuniões remarcadas antes da atualização para a 1.71.0, quando o sistema ainda não registrava a hora da remarcação, seguem como antes.

Contribuição de @webtecnica (#2249, refs #2243).
