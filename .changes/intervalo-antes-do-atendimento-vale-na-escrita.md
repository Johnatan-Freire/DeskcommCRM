---
impacto: nada_mudou
secao: corrigido
titulo: O intervalo antes/depois do atendimento passou a valer também na hora de marcar
---

Se você configurou um intervalo antes (ou depois) do atendimento — aquele
tempo de respiro entre um compromisso e outro — ele já era respeitado na
lista de horários oferecidos, mas não na hora de MARCAR (pela IA, pela API ou
por outra pessoa da equipe): um compromisso vizinho que terminasse dentro
desse intervalo podia ser aceito por engano, mesmo a lista de horários tendo
escondido aquele horário por causa dele.

Agora as duas conferências usam a mesma régua. Ao mesmo tempo, corrigimos um
efeito colateral que isso poderia trazer: mover um compromisso para um
horário logo depois do seu próprio fim não é mais recusado por "conflito"
com ele mesmo. Nada para configurar — os agendamentos que já existem seguem
como estão.
