---
impacto: nada_mudou
secao: corrigido
titulo: A mensagem de um fluxo de follow-up apagado não sai mais depois da exclusão
---
Apagar um fluxo de follow-up pela tela encerra a inscrição, mas o turno que já estava na fila (ou adiado para a janela de envio, via cron) continuava valendo: o worker enviava a mensagem e só depois conferia se a inscrição ainda existia — o cliente recebia um passo de um fluxo que não existe mais, e o item terminava como concluído, sem aviso.

Agora o turno confere a inscrição antes de qualquer efeito: se ela foi apagada, cancelada, pausada ou já saiu do nó, o envio é descartado em silêncio — a mesma regra que o caminho sem worker já aplicava. Nada muda para quem tem a inscrição viva no nó certo, e nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
