---
impacto: nada_mudou
secao: corrigido
titulo: O vigia de saúde ignora a sessão de teste do e2e em vez de vigiá-la como conexão
---

Os seeds do e2e gravam em `channel_sessions` e nada apaga a linha, então entre uma suíte e outra a conexão de teste continua lá, parada. O cron de saúde varre a tabela, pergunta ao transporte e, com `STOPPED` entre os status que avisam, abria um aviso na Central de quem opera — resíduo de teste virando alarme permanente numa instalação de verdade. A faixa do topo anunciava o mesmo caso, dizendo que nenhuma mensagem entra nem sai por aquela conexão.

Agora os dois caminhos reconhecem a categoria antes de agir: o cron conta a linha como ignorada sem perguntar nada a ela, e a faixa não a anuncia. A lista é a MESMA que a limpeza de fim de suíte apaga, e mora em `lib/channels/sessoes-e2e.ts` — num só lugar, para não haver uma cópia envelhecendo ao lado da outra. Quem não está na lista continua vigiado e anunciado como sempre, inclusive quando está mesmo caído.

Este fragmento não cobre a limpeza do resíduo que já existe em instalação (é o script do PR #1051) nem o religamento de sessão parada.

Contribuição de @webtecnica (#1032).
