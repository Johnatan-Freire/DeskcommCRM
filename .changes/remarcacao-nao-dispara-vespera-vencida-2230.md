---
impacto: nada_mudou
secao: corrigido
titulo: A reunião remarcada para menos de 24h não recebe mais o lembrete de véspera minutos depois da remarcação
---

Quando uma reunião marcada com dias de antecedência era remarcada para o dia seguinte, o lembrete de véspera saía logo depois da remarcação, porque o sistema ainda media a partir da data em que a reunião foi criada. Agora vale o momento em que o horário atual foi marcado: o lembrete cuja hora já tinha passado nesse momento não sai, e o lembrete que ainda estava por vir continua saindo na hora certa. Reuniões que nunca foram remarcadas não mudam de comportamento. Contribuição de @webtecnica (#2239, fecha #2230).
