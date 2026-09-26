---
impacto: nada_mudou
secao: corrigido
titulo: Onboarding com OpenAI não diz mais que uma chave boa falhou no teste de crédito
---

O teste de crédito do onboarding tratava como falha o 400 que um modelo de raciocínio devolve ao gastar o único token permitido: com a chave boa e com crédito, a tela dizia que o teste não tinha passado, mostrava o erro do provedor em inglês e sugeria falta de crédito. Esse 400 passa a contar como prova bem-sucedida, e quando o teste falha de verdade a tela explica o motivo em português, sem o corpo cru do provedor. Nada muda na publicação do atendente: ela continua exigindo o número de WhatsApp conectado. (#1693)

Contribuição de @hiro-nikaitou (#1699).
