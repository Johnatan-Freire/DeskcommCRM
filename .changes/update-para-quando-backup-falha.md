---
impacto: nada_mudou
secao: corrigido
titulo: update.sh para a atualização quando o backup preventivo falha
---

Antes, quando o backup automático que roda antes de toda atualização falhava,
o `update.sh` só avisava e esperava 8 segundos escondido no log — depois disso
seguia em frente, com ou sem backup, sem ninguém decidir.

Quem acompanha pelo terminal nem sempre está olhando naquele instante, e quem
atualiza pela tela do CRM (o agente do servidor, sozinho) nunca via aviso
nenhum: a atualização simplesmente continuava.

Agora, quando o backup falha:
- se você estiver acompanhando pelo terminal, a atualização pergunta e só
  segue se você digitar `CONTINUAR`;
- se for a atualização automática (pela tela, ou sem terminal por trás), ela
  para e avisa — sem seguir sozinha sem uma rede de segurança.

Nada muda para quem já tem backup funcionando normalmente.
