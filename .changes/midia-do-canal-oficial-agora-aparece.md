---
impacto: nada_mudou
secao: corrigido
titulo: Áudio, foto, vídeo e documento recebidos pelo WhatsApp oficial agora aparecem
---

Quem usa o canal oficial do WhatsApp (a API da Meta) recebia a mensagem, mas
não o arquivo — o áudio, a foto, o vídeo ou o documento simplesmente não
apareciam na conversa, e nada na tela dizia que havia algo ali.

A causa: o aviso que a Meta manda não traz o arquivo, traz um código para
buscá-lo depois. O código era guardado e nunca usado. Agora ele é guardado e
o arquivo é baixado em segundo plano, passando a aparecer na conversa como
qualquer outra mídia — pelo mesmo mecanismo que já baixa mídia do canal
WhatsApp comum.

Você não precisa fazer nada. Mensagens novas passam a trazer o arquivo a
partir desta atualização; mensagens antigas, cujo código de busca não foi
salvo, não têm como ser completadas retroativamente.
