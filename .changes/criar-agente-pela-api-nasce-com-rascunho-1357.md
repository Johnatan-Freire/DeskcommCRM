---
impacto: nada_mudou
secao: corrigido
titulo: Agente criado pela API sem `version`, ou duplicado de um agente antigo sem versão, nasce com rascunho v1 editável na tela
---

Uma integração que criava agente por `POST /api/v1/ai/agents` sem o campo `version`, e a duplicação de um agente antigo que nunca teve versão, gravavam um agente sem nenhuma versão, que nem o atendimento do CRM nem o agent-engine enxergam: ele existia na lista e nunca respondia.

Agora os dois casos nascem como agente do formato atual (`kind: "mcp_agent"`) com uma versão 1 em rascunho, montada do prompt e do modelo enviados. O agente aparece como parado e só atende depois que alguém publica a versão na tela, como qualquer agente novo; por isso ele também deixa de gerar o aviso de "agente sem versão".

A resposta da API para o formato sem `version` continua sendo a linha do agente, e o modelo omitido continua sendo `anthropic/claude-sonnet-5`. Muda o valor de `kind`, que passa de `rag_bot` para `mcp_agent`. Os agentes antigos que já existem não são alterados.

Contribuição de @webtecnica (#2296).
