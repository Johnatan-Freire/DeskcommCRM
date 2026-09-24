---
impacto: capacidade_nova
secao: adicionado
titulo: Quem administra pode desfazer o descadastro de um contato
---

Quando um cliente pede para sair ("parar de me mandar", "sair da lista"), o contato fica bloqueado e nada automático volta a escrever para ele: campanha, follow-up, lembrete e IA param. Até aqui o bloqueio não tinha volta, nem para quem mudou de ideia nem para quem caiu num falso positivo. Agora quem tem papel de administrador vê o botão **Desbloquear** na tela do contato bloqueado. A ação pede confirmação e fica registrada na auditoria (`contact.unblocked`), ao lado do registro do pedido original, que continua lá. Desbloquear devolve o direito de enviar, mas não retoma follow-up nem campanha cancelados, e um novo pedido de descadastro do cliente volta a bloquear o contato.

Contribuição de @deskcommopp4s-cmd (#1604).
