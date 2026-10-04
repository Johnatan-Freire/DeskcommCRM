---
impacto: nada_mudou
secao: corrigido
titulo: Numa conversa de atendimento, preencher resposta pronta e abrir conversa ficam no contato da conversa
---

Numa conversa de atendimento, `crm_render_message_template` passa a preencher a resposta
pronta apenas com os dados do contato daquela conversa: um `contact_id` ou um `lead_id` de
outro contato é recusado, e sem nenhum dos dois o contato da conversa é usado. Em
`crm_get_conversation`, toda conversa que não é do contato da conversa recebe a mesma
recusa. Fora de uma conversa de atendimento (integração, MCP externo, rota HTTP), nada muda.
