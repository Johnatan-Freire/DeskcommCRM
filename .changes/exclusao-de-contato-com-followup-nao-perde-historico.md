---
impacto: nada_mudou
secao: corrigido
titulo: Excluir um contato que já passou por retorno automático não perde mais o histórico
---

Quem tentava excluir pela tela um contato que já passou por um retorno automático levava um erro **e** ficava com a ficha na base sem histórico: as mensagens e as conversas já tinham sido apagadas quando a exclusão foi recusada. A auditoria registrava `contact.delete_blocked` com `apagados: ["messages","conversations"]` — o rastro exato do estrago.

O defeito tinha duas metades e as duas foram consertadas. O banco recusava com `42501` o DELETE que chega **em cascata** quando a ficha é apagada, porque o gatilho de proteção do follow-up não distinguia cascata de escrita direta — agora ele distingue pela profundidade do gatilho: a cascata passa, quem apaga um turno de follow-up pela API com sessão de usuário continua sendo recusado, como sempre. E a rota, que apagava mensagens, conversas e a ficha em **três passos separados**, passa a chamar uma função única: as três saem numa transação só, ou sai tudo ou não sai nada.

Ficha com compromisso na agenda continua sendo recusada antes de qualquer coisa ser apagada, e uma exclusão que falhe por qualquer outro motivo deixa o histórico exatamente onde estava. Nada muda para quem opera além de a exclusão passar a funcionar. Não exige ação.

Contribuição de @webtecnica (#1912).
