---
impacto: nada_mudou
secao: corrigido
titulo: A recusa "o atendimento desta conversa mudou" para de citar um link que não existe em compromisso sem Meet
---

A frase que `meet_conversation_stale` mostra na tela dizia "O atendimento desta conversa mudou **depois que o link foi criado**". Em compromisso PRESENCIAL ou POR TELEFONE não existe link nenhum, então a frase afirmava um fato que não aconteceu — e é a frase que aparece no fluxo natural do atendente (resolver a conversa → marcar o compromisso → mandar os dados), porque quem recusa é `fn_meet_boundary_current`, que compara `service_revision`, `current_demanda_id`, `demanda.revision`, `fechada_em` e o status da conversa, nunca um link.

A frase passa a dizer só o que é verdade nos dois casos: "O atendimento desta conversa mudou. Escolha a conversa atual e autorize o envio de novo." Nenhuma mudança de fluxo, de status ou de recusa — só a frase. As traduções (`es` no dicionário e `en.json`) acompanham a chave nova.

O ponto de produto que o relator também sugeriu (texto próprio quando o atendimento está ENCERRADO, ou o envio abrir um novo atendimento) continua em aberto: escolher entre as duas é decisão de mantenedor, e este fragmento não toma nenhuma delas.

Contribuição de @webtecnica (#2188).
