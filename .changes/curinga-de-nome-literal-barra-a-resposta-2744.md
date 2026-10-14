---
impacto: nada_mudou
secao: corrigido
titulo: Resposta com {{nome}} literal não sai mais para o cliente
---

Quando o contato não tem nome no CRM nem um nome de exibição de pessoa, uma resposta com {{nome}} ou {{primeiro_nome}} ia para o cliente com a variável crua. Agora o compositor barra o envio dessa resposta e mostra uma faixa explicando o motivo enquanto o atendente edita o texto. O campo continua editável: basta apagar a variável ou escrever o nome para enviar. Notas internas continuam passando, e contatos com nome não veem diferença. A legenda de anexo ainda não tem essa trava.

Contribuição de @webtecnica (#2844), a partir da issue #2744.
