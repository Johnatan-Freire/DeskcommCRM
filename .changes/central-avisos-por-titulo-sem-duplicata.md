---
impacto: nada_mudou
secao: corrigido
titulo: A Central para de abrir em dobro os avisos de IA por título (Jev parado, saldo, endereço sem chave)
---

Quatro avisos da Central deduplicam pelo TÍTULO — o "O Jev parou de funcionar", o de IA sem saldo, a recusa por endereço sem chave da empresa e o aviso de laço do processamento de eventos. A pergunta "já existe um aberto?" e a escrita não eram atômicas, e os escritores rodam concorrentes: o worker roda tarefas em paralelo e o aviso do Jev chega por dois drenos. Dois avisos idênticos apareciam para o mesmo problema.

Agora o banco é quem segura: um índice único parcial em `agent_inbox_items` (organização, kind e título, só enquanto o aviso está aberto) recusa a segunda linha, e os quatro escritores tratam a recusa como "já havia aviso" — nenhum deles para de avisar. Avisos que abrem UM POR NEGÓCIO (o espelho de estágio e o de etapa) continuam abrindo um por negócio, mesmo com o título repetido.

Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
