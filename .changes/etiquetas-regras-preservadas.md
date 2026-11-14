---
impacto: nada_mudou
secao: corrigido
titulo: Duas regras do mesmo evento que adicionam etiquetas não apagam mais a etiqueta uma da outra
---

Quando um mesmo evento disparava duas regras com "adicionar etiqueta" no negócio, a segunda regravava a lista a partir da foto do contexto e apagava a etiqueta que a primeira tinha acabado de gravar. Agora a ação lê as etiquetas atuais do negócio, filtradas pela organização, antes de juntar as novas, e a foto do contexto passa a carregar o que foi gravado. Se a leitura falha, nada é gravado e nenhum evento é anunciado. Dois eventos diferentes processados ao mesmo tempo ainda podem disputar a mesma lista; esse caso pede uma operação atômica no banco e fica fora deste conserto. Nenhuma mudança de banco.

Contribuição de @andersontomazi-ctrl (#2864), adaptada de jmpo/DeskcommCRM#89, de @jmpo.
