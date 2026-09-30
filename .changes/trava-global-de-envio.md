---
impacto: exige_acao
secao: adicionado
titulo: Nenhuma mensagem sai para clientes sem uma autorização explícita da instalação
---

Existe agora uma trava única para todo envio de mensagem de conversa: resposta
da IA, follow-up, automação, campanha, lembrete de agenda, resposta aprovada,
aviso de que uma pessoa vai assumir, reenvio de fila e mensagem escrita à mão
na Inbox. Com ela desligada, nada chega ao WhatsApp nem aos outros canais,
qualquer que seja o estado do agente, do fluxo ou da conexão.

A mensagem continua aparecendo na conversa, marcada como falha com o motivo
"Envio de mensagens desligado nesta instalação", e não é reenviada sozinha
quando o envio for ligado depois.

## Requer atenção

A trava nasce **desligada**. Depois desta atualização, nenhuma mensagem sai até
você autorizar. Para voltar a enviar, acrescente ao `.env` da instalação:

    OUTBOUND_MESSAGING=enabled

e reinicie app, worker e scheduler. Qualquer outro valor (ou a linha ausente)
mantém o envio desligado.
