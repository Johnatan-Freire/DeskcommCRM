---
impacto: nada_mudou
secao: corrigido
titulo: O item "demanda aberta sem próximo passo" do Radar vira link, e o caso cancelado ou resolvido marca um próximo passo na demanda que ele abriu
---

No Radar de risco, o item "demanda aberta sem próximo passo" deixava de ser só
texto: agora é um link para a conversa vigente da demanda (ou, sem conversa,
para a ficha do contato), como já eram as outras seções — dava para chegar à
demanda pelo alerta.

E um caso cancelado ou resolvido passa a marcar um próximo passo na demanda que
ele abriu por handoff ("Revisar o caso encerrado e registrar o desfecho da
demanda"): antes ela ficava "em atendimento" e sem próximo passo para sempre,
presa na seção de risco do Radar. O sistema não decide o desfecho — só tira a
demanda de "sem próximo passo" e a deixa visível em "Demandas abertas" do painel
da conversa, com "Encerrar demanda" ao lado, até alguém registrar o desfecho.

Demanda antes presa em `em_atendimento` num caso rescindido não é
retroativamente corrigida por esta versão. Sem ação necessária.

Contribuição de @webtecnica (#2056).
