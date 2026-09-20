---
impacto: nada_mudou
secao: corrigido
titulo: O nome do compromisso pessoal da agenda do Google deixa de ficar ao alcance dos colegas
---

Quem conecta a agenda pessoal do Google ao CRM costuma fazer isso só para os
horários ocupados contarem na agenda da equipe. Nenhuma tela deste produto
jamais mostrou o nome desses compromissos, mas o worker de sincronização
gravava esse nome no banco mesmo assim — e a permissão da tabela deixava
qualquer pessoa da organização, inclusive com acesso somente leitura,
consultá-lo diretamente pela API, com o próprio login.

Agora o worker nunca grava o nome real: só o horário, como já era mostrado. A
atualização também limpa, sozinha, os nomes que já tinham sido sincronizados
por versões anteriores — sem exigir nenhuma ação de quem opera a instalação.
Os horários ocupados continuam contando exatamente como antes; só o nome do
compromisso deixa de existir no banco.
