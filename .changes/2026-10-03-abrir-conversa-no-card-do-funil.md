---
impacto: capacidade_nova
secao: adicionado
titulo: Card do funil e dossiê do lead ganham a ação "Abrir conversa"
---

Lead recebido por webhook chega ao funil com telefone e sem conversa nenhuma, e nem o card nem o dossiê ofereciam jeito de começar o atendimento: o atalho só existia quando a conversa já estava lá. Agora o card e o painel do lead mostram o botão "Abrir conversa" quando o negócio tem contato — ele chama a MESMA rota que a tabela de contatos usa (POST /api/v1/conversations/open-with-contact), que reabre a conversa que já existe ou cria a que falta, e leva para a Inbox na conversa aberta. Conversa já vinculada continua sendo um elo direto, sem ida ao servidor. Sem telefone, o botão fica desabilitado na linha dizendo o motivo, e nenhuma chamada sai do navegador. Nenhuma mudança de banco: os dados já estavam no payload do quadro.

Contribuição de @webtecnica (#2207, refs #1993).
