---
impacto: nada_mudou
secao: corrigido
titulo: Os candidatos da prospecção nativa agora têm prazo, e é o cron quem apaga
---

A tabela `prospecting_candidates` nascia sem dono de expurgo: nome, telefone e endereço de pessoas pesquisadas e nunca contatados ficavam para sempre, e uma campanha montada e abandonada deixava esse dado parado sem nenhum evento que o expirasse.

A política de retenção passa a valer de verdade: **365 dias de padrão (piso de 90)** — decisão do dono, alinhada ao horizonte da conversa do caso e da captação — aplicados pela nova função `fn_expurgar_prospeccao_vencida`, chamada em lotes pelo cron diário `data-retention`, com o piso dentro do corpo da função como os demais prazos da casa. O relógio conta da criação para quem nunca foi contatado e da última tentativa para quem já recebeu mensagem; `queued` e `sending` nunca entram, e os tokens de supressão (`suppression_*`) de quem pediu opt-out/exclusão são preservados para sempre, garantindo que uma reimportação futura não traga a pessoa de volta.

Quem opera a VPS não faz nada: a correção chega na próxima atualização. O valor pode ser ajustado com `PROSPECCAO_RETENTION_DAYS` no `.env`, como os demais prazos de retenção.

Contribuição de @webtecnica.
