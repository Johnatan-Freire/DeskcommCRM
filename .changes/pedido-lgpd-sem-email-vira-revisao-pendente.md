---
impacto: nada_mudou
secao: corrigido
titulo: Pedido de dados LGPD numa instalação sem e-mail passa a "Revisão pendente", com o PDF para você entregar, em vez de ficar em "Processando" para sempre
---

Numa instalação sem e-mail de entrega configurado (sem Resend e sem SMTP), ou quando o titular não tem endereço de e-mail, o relatório de dados pessoais era gerado, mas o pedido nunca saía de "Processando": o banco recusava o estado "Revisão pendente" e o sistema seguia calado. A tela também não oferecia o PDF para baixar, e a limpeza automática de mídias antigas da organização ficava parada enquanto houvesse um pedido assim. O defeito apareceu ao provar o #2669 pela tela.

Agora o pedido vai para "Revisão pendente", e a página do pedido, em Configurações › Dados e acesso › LGPD, mostra o botão "Baixar PDF" para você entregar o relatório ao titular por um canal seu. O mesmo estado passa a valer para os pedidos de anonimização que caem em revisão (contato sem registro local, ou anonimização da organização com falha parcial).

Você não precisa fazer nada: pedidos que já estavam presos em "Processando" por esse motivo são corrigidos na atualização. A correção só alcança os pedidos com o registro do sistema que mostra que o relatório foi gerado. Se algum pedido continuar em "Processando" depois de atualizar, abra-o e confira a "Trilha de auditoria". Se não houver nela uma linha `lgpd.export_generated`, o relatório nunca chegou a ser feito, e não há como reprocessar o pedido pela tela.
