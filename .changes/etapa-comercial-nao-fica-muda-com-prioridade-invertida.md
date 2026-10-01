---
impacto: nada_mudou
secao: corrigido
titulo: Contato de etapa comercial não fica sem resposta quando o agente acadêmico tem prioridade maior
---

Com um agente comercial e um agente acadêmico no mesmo número e sem roteador,
dar ao acadêmico uma prioridade maior que a do comercial fazia todo contato em
etapa comercial ficar sem resposta: o sistema recusava o acadêmico ali (certo)
e, para achar quem atendesse, voltava a escolher o de maior prioridade, que
era o mesmo acadêmico. Agora ele procura o agente comercial do número. A
prioridade continua decidindo o desempate entre agentes do mesmo tipo.
