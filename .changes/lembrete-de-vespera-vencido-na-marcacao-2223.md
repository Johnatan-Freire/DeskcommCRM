---
impacto: nada_mudou
secao: corrigido
titulo: O lembrete de véspera não sai mais na hora quando a reunião é marcada com menos de 24h, nem sai duas vezes
---

Lembrete cuja hora já tinha passado quando a reunião foi marcada não sai mais, e isso vale para qualquer lembrete, inclusive o principal: reunião marcada com menos antecedência que o lembrete não recebe esse lembrete (por exemplo, num tipo de compromisso que só tem o lembrete de véspera, a reunião marcada para o dia seguinte não recebe nenhum). O mesmo lembrete não sai duas vezes para o mesmo compromisso, mesmo quando a gravação do envio falha: se o registro não grava, a rodada não envia e tenta na seguinte, e o lembrete que falha no envio depois de registrado não é reenviado. A reunião remarcada para menos de 24h ainda pode disparar a véspera na hora (acompanhado numa issue separada). Contribuição de @webtecnica (#2226, refs #2223).
