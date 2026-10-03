---
impacto: nada_mudou
secao: corrigido
titulo: "Mandar ao cliente" passa a enviar compromisso que não é Google Meet
---

Num compromisso **presencial**, ou de qualquer local que não seja Google Meet, clicar em **Mandar ao cliente** era aceito e não enviava nada: o job de entrega terminava falhando, sempre, e o cliente nunca recebia os dados do compromisso. O campo que guarda a solicitação de link era nulo dos dois lados, e a checagem que libera o envio comparava os dois com `=`, que em SQL não é verdadeiro quando os dois são nulos — então a entrega era recusada por "acesso ou revisão desatualizada" mesmo com tudo em ordem.

Agora a checagem é a mesma que o resto do sistema já usa para esse campo: nulo de um lado e nulo do outro é o estado legítimo de quem não tem reunião por link, e continua recusando quando os identificadores não batem. Reunião com link pronto segue funcionando como antes.

Nada é preciso fazer na instalação, e nenhum compromisso existente muda: o que muda é a leitura do mesmo registro na hora de enviar.

Contribuição de @Tong-bit-art (#2192, refs #2188); causa medida no banco por @amexgestao.
