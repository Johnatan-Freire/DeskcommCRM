---
impacto: nada_mudou
secao: corrigido
titulo: O passo "Classificar resposta" dos fluxos de follow-up espera o cliente responder
---

Num fluxo que manda uma mensagem e em seguida classifica a resposta com a IA, o
passo de classificar seguia pela saída "Sem resposta" poucos segundos depois do
envio, sem dar ao cliente o tempo de espera configurado no passo (15 minutos
por padrão, ou o prazo que você escolheu). O cliente que respondia dentro desse
prazo já tinha sido tratado como quem não respondeu.

Agora o passo espera o prazo inteiro:

- se o cliente responder dentro dele, a resposta dele à mensagem do fluxo é
  classificada e o fluxo segue pelo caminho da classe — inclusive quando o
  agente ou alguém da equipe já respondeu ao cliente antes;
- se o prazo acabar sem resposta, o fluxo segue por "Sem resposta", e uma
  condição "Desfecho do passo anterior" logo depois enxerga esse desfecho;
- enquanto espera, a história do follow-up mostra "Esperando a resposta do
  cliente" com a hora limite, em vez de parecer parada.

Não é preciso fazer nada para receber a correção. Quem colocou um passo
"Aguardar" antes do "Classificar resposta" para contornar o problema vai ver os
dois tempos somados (a espera do "Aguardar" e depois o prazo do classificar);
se a espera extra não faz mais sentido, basta tirar o "Aguardar" do fluxo.
