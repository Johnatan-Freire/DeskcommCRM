---
impacto: nada_mudou
secao: corrigido
titulo: A Central para de abrir em dobro o aviso de resposta a caso obsoleto quando a rota e o worker escrevem no mesmo instante
---

A resposta de um humano a um caso que já mudou de atendimento abre um aviso na Central ("Resposta registrada; atendimento mudou"), deduplicado por conversa. Dois escritores podiam chegar juntos — a rota que registra a resposta e o worker que percebe a fronteira de serviço velha — e os dois inseriam, porque a pergunta "já existe um aviso aberto?" e a escrita não eram atômicas.

Agora o banco é quem segura: um índice único parcial em `agent_inbox_items` (organização, kind e conversa, só enquanto o aviso está aberto) recusa a segunda linha. A resposta do humano continua sendo registrada mesmo quando o aviso já existia — o caminho transacional isola o aviso num savepoint, para que a recusa do banco não derrube a resolução do caso. Avisos `job_dead` de tarefa e de cron seguem como sempre foram, um por ocorrência.

Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
