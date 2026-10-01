---
impacto: capacidade_nova
secao: adicionado
titulo: O tempo que o agente espera antes de responder passa a ser ajustável por número
---

A proteção de envio de cada número (em Conexões › Proteção de envio) ganhou quatro campos para o "tempo de pensar" do agente antes da primeira mensagem da resposta: o tempo para ver a notificação, o tempo por caractere digitado, o mínimo e o máximo. Campo vazio mantém exatamente o ritmo de antes (0,9 s + 22 ms por caractere, entre 1,2 s e 7,5 s). Um mínimo acima do máximo é recusado na hora, com a explicação na tela.

Quando a resposta sai em várias mensagens, o intervalo entre elas passa a seguir o "intervalo entre mensagens" configurado para o número, em vez de um valor fixo de 1,2 s a 2 s. Quem nunca mudou esse intervalo não nota diferença; quem mudou vê as mensagens da resposta seguindo o valor escolhido.

Não é preciso fazer nada na instalação: a atualização acrescenta as colunas sozinha.

Contribuição de @webtecnica (#1996), fechando a #653.
