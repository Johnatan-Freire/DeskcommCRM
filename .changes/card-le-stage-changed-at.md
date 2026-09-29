---
impacto: nada_mudou
secao: corrigido
titulo: O tempo na etapa do card do Kanban não zera mais a cada nota ou mensagem
---

O rodapé do card do Kanban contava o "tempo no estágio" a partir da última atividade do negócio: qualquer nota, edição ou mensagem na conversa zerava o relógio de um negócio parado na mesma etapa havia dias. Agora o tempo é contado a partir da entrada na etapa atual (a coluna `crm_leads.stage_changed_at`, carimbada pelo banco desde a migration 0071), e só mudar de etapa zera o relógio. Negócio sem esse registro cai na data de criação, nunca na última mensagem. Contribuição de @webtecnica (PR #1908).
