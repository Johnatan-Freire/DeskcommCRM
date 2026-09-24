---
impacto: nada_mudou
secao: corrigido
titulo: O rascunho de resposta chega sem esperar um resumo da conversa que ninguém usa
---

No modo assistido, depois de escrever o rascunho o agente ainda pedia ao modelo um resumo da conversa (o checkpoint) e só entregava o rascunho quando esse resumo terminava. Nesse modo o resumo não é gravado nem lido por ninguém, e a espera era a maior parte do tempo: medido em produção, a resposta ficou pronta às 12:32:40 e o rascunho só apareceu às 12:32:56 — 16 dos 28 segundos depois de "Sugerir resposta". Agora o rascunho sai assim que a resposta fica pronta. O teste do agente (a tela de prévia) continua mostrando o resumo, e o aviso de "o agente não propôs uma resposta" continua valendo.
