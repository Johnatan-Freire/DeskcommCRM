---
impacto: nada_mudou
secao: corrigido
titulo: Entrar com Google entra no CRM direto, em vez de voltar para a tela de login com a sessão já criada
---

Quem entrava com Google terminava na tela de login, como se o login tivesse falhado — mesmo com a sessão já criada: abrindo o CRM de novo, a pessoa estava logada. A volta do Google passou a entregar uma página do próprio CRM antes de seguir para a tela pedida, o que faz o navegador tratar a navegação seguinte como sendo do próprio site e enviar o cookie de sessão. Os cookies de sessão continuam restritos como estavam, e nenhuma configuração precisa ser mexida. Não há ação para quem opera a VPS.

Contribuição de @webtecnica (#1674).
