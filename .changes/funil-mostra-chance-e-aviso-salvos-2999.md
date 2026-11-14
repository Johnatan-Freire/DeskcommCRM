---
impacto: nada_mudou
secao: corrigido
titulo: Configurações › Funis mostra a chance de fechamento que você salvou, e apagá-la passa a gravar
---

A chance de fechamento de cada etapa era gravada, mas a leitura que a tela de Configurações › Funis usa não a devolvia. Por isso o campo aparecia vazio ao recarregar, e reabrir o funil fazia parecer que a calibração tinha se perdido. Pelo mesmo motivo, apagar uma chance já gravada não chegava a gravar nada: a tela achava que o campo já estava vazio. Agora a leitura devolve o valor, e apagar volta a etapa para "sem calibração". A leitura de etapas da API (`GET /api/v1/pipelines/{id}/stages`) também passa a trazer a chance de fechamento e o aviso na Central.

Contribuição de @webtecnica (refs #2999).
