---
impacto: capacidade_nova
secao: adicionado
titulo: O agente de IA passa a conversa para outro agente do mesmo número
---

Quando um número tem mais de um agente de IA, o agente que está atendendo
ganha a ferramenta `transfer_to_agent`. Se o assunto do cliente é de outro
agente, ele avisa o cliente e passa a conversa. A partir da próxima mensagem,
quem responde é o agente escolhido, que vê toda a conversa.

A passagem vence a regra da etapa do funil enquanto durar o atendimento. É o
caso do aluno que pergunta de outro curso: o agente de Alunos o passa ao
Comercial, e o Comercial atende mesmo com o contato em etapa acadêmica.
Quando a conversa é encerrada, a passagem acaba, e no próximo atendimento a
etapa volta a decidir.

O que não muda:

- uma etapa só de atendimento humano, ou encerrada, continua sem resposta de IA;
- um agente pausado não recebe conversa;
- os follow-ups automáticos continuam só para contatos em etapa comercial.

Cada passagem fica registrada na trilha de decisões dos agentes, com o agente
de origem, o de destino, quem pediu e quando. Essa trilha passa a ser gravada
só pelo servidor; a equipe continua podendo lê-la.

Para o agente usar a ferramenta, o prompt dele precisa dizer quando passar a
conversa. Não é preciso mexer em nada na VPS.
