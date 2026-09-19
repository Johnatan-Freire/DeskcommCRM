---
impacto: capacidade_nova
secao: corrigido
titulo: O worker passa a dizer se o laço do event_log carregou
---

O laço que processa eventos internos (mídia, follow-up, branding) dentro do
worker podia falhar ao carregar — por um import quebrado, por exemplo — e
ficar parado indefinidamente sem que nada avisasse: o `/healthz` continuava
respondendo saudável, e o problema só aparecia como sintoma indireto (mídia
que nunca processa, follow-up que não dispara). O cron de segurança
(`event-log-drain`, a cada minuto) continuava rodando, então nada parava por
completo, mas a resposta ficava mais lenta sem ninguém saber o motivo.

Agora o `/healthz` do worker publica um campo `event_log_drain` dizendo se o
laço carregou e, se não, por quê. Uma falha ao carregar também vira log de
erro, não mais aviso de rotina — é a diferença entre "aconteceu e ninguém vê"
e "aconteceu e está registrado".
