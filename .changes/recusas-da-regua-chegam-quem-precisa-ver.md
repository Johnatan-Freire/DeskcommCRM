---
impacto: capacidade_nova
secao: corrigido
titulo: As recusas da régua de campos obrigatórios agora chegam a quem precisa ver
---

Com a régua na criação de negócio (#2295), quatro caminhos recusavam sem que a pessoa certa visse — ou deixavam um resto. Os quatro passam a se comportar assim:

1. **Roteador de intenção (#2290).** Quando a etapa de destino exige um campo, `transfereParaOFunil` lança e a recusa morria num `runLog.warn` que ninguém lê. Agora a recusa é capturada em `aplicaDestinoDaIntencao` — onde o negócio de origem é conhecido — e abre um aviso na Central (`kind: other`, apontando para o negócio), sem empilhar o mesmo aviso aberto. O negócio de origem continua aberto, como antes: nada se perde, e agora alguém fica sabendo.
2. **Tool MCP `crm_create_lead`.** Ganhou `custom_fields` no `inputSchema`: o agente que sabe o valor consegue criar um negócio numa etapa exigente, pelo mesmo `createLeadHandler` e a mesma régua de todo mundo. Sem a chave, `z.object` descartava o argumento antes de chegar a quem pergunta a exigência.
3. **Import de planilha.** O contato da linha 1 é criado antes do `createLeadHandler` da mesma linha, e um 422 da régua (ou um 404 de etapa) derruba a importação inteira: agora os contatos que ESTA requisição criou e que ficaram sem negócio são devolvidos ao banco antes da resposta de erro. Os que já estavam no cadastro e os que já viraram card nunca entram no desfazimento.
4. **Captação.** O motivo da recusa na tela "Leads recebidos" deixa de ser `erro_ao_criar_lead` para tudo: a régua vira `recusa_da_regra` com rótulo próprio, funil/etapa seguem com o rótulo original, e o resto vira `erro_inesperado` — o rótulo não promete mais "funil e etapa" numa recusa que não é deles.

A régua não afrouxa em nenhum dos quatro: a isenção da rota de captação (`exigirCamposDaEtapa: false`, decisão do #2295) continua intacta, e nenhum caminho passa a criar o que a régua recusava.

Contribuição de @webtecnica (#2297).
