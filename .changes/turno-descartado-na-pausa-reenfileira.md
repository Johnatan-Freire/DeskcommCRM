---
impacto: nada_mudou
secao: corrigido
titulo: O follow-up pausado volta a andar quando o atendimento humano termina
---
Um follow-up que estava no passo de enviar mensagem e ficava pausado porque uma pessoa assumiu o atendimento perdia o envio em silêncio: o turno rodava durante a pausa, era descartado, e nada ficava registrado. Quando o atendimento era retomado, o motor continuava achando que aquele turno estava em voo — só conferia de novo, nunca mandava outro — e o fluxo ficava parado no mesmo passo até o sistema marcá-lo como morto por tempo esgotado, com um motivo que não era o verdadeiro.

Agora o descarte durante a pausa deixa o mesmo rastro que a suspensão da conta já deixava: na retomada, o passo é reenfileirado e a mensagem sai normalmente. Follow-ups encerrados, passos que já andaram e fluxos apagados continuam descartados em silêncio, como antes — e nada precisa ser feito na instalação.

Contribuição de @webtecnica.
