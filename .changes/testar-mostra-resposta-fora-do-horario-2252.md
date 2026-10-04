---
impacto: nada_mudou
secao: corrigido
titulo: O Testar do agente mostra a resposta mesmo fora do horário de envio, com um aviso
---
Fora do horário de envio configurado, o botão Testar do agente escondia a resposta: a regra de ritmo de envio (horário, aquecimento do número e limite diário) barrava o candidato também no teste, onde nada é enviado. Agora o Testar mostra a resposta com o aviso de que, em produção, ela não sairia naquele momento, e o registro da verificação diz que essa regra não foi aplicada ao teste, em vez de dizer que passou. O envio real não muda: fora do horário ele continua barrado. Só essa regra é afrouxada, e só no Testar; a janela de 24 horas do WhatsApp, o descadastro e as regras de conteúdo seguem na mesma cadeia de antes, e o rascunho do modo assistido continua barrado fora do horário.

Na aba Execuções, as rodadas do Testar passam a aparecer como teste. Os rascunhos do modo assistido, que atendem conversas reais, continuam aparecendo como produção. E um teste que não produziu resposta deixa de aparecer como aprovado.

Contribuição de @leadframeassessoria-lab (substitui #2252).
