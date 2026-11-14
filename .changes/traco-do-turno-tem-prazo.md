---
impacto: capacidade_nova
secao: adicionado
titulo: O registro de cada resposta do agente passa a ser apagado depois de 90 dias
---

Cada resposta do agente grava um registro técnico: qual versão do prompt
respondeu, quais ferramentas usou, quanto custou e quanto demorou. Esse registro
não tinha prazo e crescia para sempre. Agora a limpeza diária apaga o que tem
mais de 90 dias. O texto das mensagens não fica nesse registro e não é afetado.

O prazo muda com `TURN_TRACE_RETENTION_DAYS` no `.env` (mínimo de 30 dias).
Quem não mexer fica com 90 dias, sem editar nada.
