---
impacto: nada_mudou
secao: corrigido
titulo: A Central para de abrir em dobro os avisos de orçamento de IA (limite atingido e aviso de gasto)
---

Os dois avisos de orçamento — "o orçamento de IA foi atingido" e "o gasto passou do aviso" — deduplicam por organização e tipo, mas a pergunta "já existe um aberto?" e a escrita não eram atômicas, e dois turnos podem avaliar o gasto no mesmo instante (o worker roda tarefas em paralelo, e o worker de respostas é outro processo). Dois avisos idênticos apareciam para o mesmo problema.

Agora o banco é quem segura: um índice único parcial em `agent_inbox_items` (organização e tipo, só enquanto o aviso está aberto) recusa a segunda linha. A decisão do orçamento continua chegando inteira — os dois caminhos do motor tratam a recusa como "já havia aviso", sem trocar o bloqueio por um erro. E a escrita do aviso não depende de o índice já existir: para quem atualiza, tanto faz se o código novo sobe antes ou depois do banco — o portão de orçamento segue fechando, e a deduplicação vale a partir do momento em que o índice chega. Os dois tipos convivem abertos, como sempre: um relata que a IA parou, o outro que o gasto passou do aviso e ela segue.

Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art (#2265, com o refinamento do #2266).
