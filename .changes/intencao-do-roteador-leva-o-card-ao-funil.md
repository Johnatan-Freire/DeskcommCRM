---
impacto: capacidade_nova
secao: adicionado
titulo: Cada intenção do roteador pode levar o negócio para o funil certo
---
Na tela do roteador, cada intenção ganha um campo opcional de funil de destino (e, se quiser, a etapa; sem etapa, vale a primeira etapa aberta do funil). Quando o roteador escolhe a intenção, o negócio do cliente vai para esse funil antes de o agente responder, e o agente passa a trabalhar no card do time certo. Até aqui o roteador só escolhia o agente, e o card ficava no funil de entrada.

Sem destino configurado, nada muda: quem atualiza continua com o roteamento de antes. Se o cliente troca de assunto para outra intenção que tem destino, o card vai para o novo funil e o negócio anterior é encerrado como transferência, com o motivo "Levado para outro funil", que não conta como perda nas métricas. A linha do tempo registra que foi o roteador de intenção quem levou o card. Se o contato já tem um negócio aberto no funil de destino, nenhum card novo é criado.

Contribuição de @webtecnica (#2155).
