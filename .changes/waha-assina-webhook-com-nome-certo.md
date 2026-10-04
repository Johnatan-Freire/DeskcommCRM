---
impacto: nada_mudou
secao: corrigido
titulo: O WAHA passa a assinar as entregas de webhook e a exigência de assinatura passa a funcionar
---

O compose entregava o segredo ao contêiner do WAHA numa variável que não existe na documentação dele (`WHATSAPP_HOOK_HMAC` em vez de `WHATSAPP_HOOK_HMAC_KEY`), então o WAHA ignorava e nunca assinava nada — e ligar "Exigir assinatura nas entregas do canal" cortava a entrada de mensagens com `401 signature_required`.

Agora o nome é o exato da documentação (nos três composes e no runbook). Na atualização o contêiner do WAHA é recriado e passa a mandar `X-Webhook-Hmac` em toda entrega; quem tem a exigência ligada volta a receber mensagens, agora com `valid_signature = true` no log. Nenhuma ação do operador: o segredo é o mesmo, só o nome da variável mudou.
