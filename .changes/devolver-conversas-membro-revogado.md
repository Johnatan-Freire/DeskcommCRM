---
impacto: nada_mudou
secao: corrigido
titulo: Membro revogado da empresa tem conversas abertas desatribuídas de volta para a fila
---

Ao revogar um membro da organização, suas conversas abertas não eram desatribuídas pelo trigger `fn_routing_member_revoked`: conversas que haviam sido assumidas permaneciam vinculadas a um usuário revogado e com o robô silenciado sem prazo (`bot_silenced_until = 'infinity'`), tornando-as mudas para a IA e invisíveis na fila dos demais atendentes até uma intervenção manual. Agora, a revogação desatribui automaticamente todas as conversas abertas do membro (`status in ('open','pending','claimed','ai_handling')`), limpa as informações de responsável, solta o silenciamento do bot (exceto quando a conversa foi passada pela IA a um humano, que continua na fila humana), registra o evento em `conversation_assignment_events`, acorda o roteamento por canal e emite a atividade de liberação na linha do tempo com a respectiva auditoria. Contribuição de @webtecnica (#1619).
