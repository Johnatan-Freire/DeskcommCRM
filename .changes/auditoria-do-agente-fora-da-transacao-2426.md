---
impacto: nada_mudou
secao: corrigido
titulo: A auditoria e o veto do agente saem da janela que travava atrás de uma mudança na tabela de contatos
---

Quando o agente ia responder, a linha de auditoria da decisão (e, no veto, o registro na linha do tempo e o aviso de LGPD) era gravada por outra conexão enquanto a vez do número ainda estava presa. Com uma mudança de estrutura na tabela de contatos esperando na fila — o que acontece durante uma atualização —, essa gravação esperava a mudança, a mudança esperava a vez do número e a vez do número esperava a gravação: o worker parava sem erro nenhum. Agora a auditoria e o veto são gravados depois que a vez do número é liberada, e uma resposta vetada não entra mais nesse ciclo.

O envio em si ainda pode esperar: o registro da mensagem enviada continua sendo gravado com a vez do número presa, e fechar essa outra metade é o que a issue #2426 segue pedindo. Nada muda para quem opera a VPS: nenhuma configuração nova, nenhum passo manual.

Contribuição de @webtecnica (#2827), a partir da issue #2426.
