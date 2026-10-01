---
impacto: capacidade_nova
secao: adicionado
titulo: Atualizar lead e marcar/remarcar/cancelar compromisso por integração externa
---

`PATCH /api/v1/leads/[id]` e `POST/PATCH/DELETE /api/v1/agenda/agendamentos`
passam a aceitar `Authorization: Bearer dsk_...` (com o escopo `mcp:write`)
além da sessão do navegador — o mesmo padrão que `/api/v1/messages` e
`/api/v1/contacts` já usavam. Serve qualquer integração de servidor que precise
atualizar um negócio ou marcar um compromisso sem navegador (ex.: monitoramento
de andamento processual via n8n). Na agenda, a chave precisa do mesmo papel
que as ferramentas de agenda do agente de IA exigem: ao criar a chave em
Configurações › API Tokens, marque "Tratar o token como gerente" — a chave
comum (atendente) recebe `403` ao marcar, remarcar ou cancelar, pela API e
pelo MCP igualmente. Por chave, vale o mesmo teto de escrita do
envio de mensagens: acima dele a resposta é `429` com `Retry-After`. Nada muda
para quem usa a tela.

Contribuição de @nsbastosconsultoria (#1578).
