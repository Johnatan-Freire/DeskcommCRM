---
impacto: nada_mudou
secao: corrigido
titulo: Anonimizar um contato também apaga os dados das fichas que foram juntadas nele
---

Juntar fichas duplicadas move conversas e negócios para o contato principal,
mas a ficha absorvida continua guardada, com o nome, o telefone e o e-mail que
tinha antes. Ao atender um pedido de apagamento (LGPD), só o contato principal
era anonimizado, e esses dados ficavam no banco.

Agora a anonimização alcança cada ficha juntada no contato, inclusive as
juntadas em cadeia, e cada uma fica registrada na auditoria. Ao atualizar, as
fichas que ficaram para trás em contatos já anonimizados também são
anonimizadas.

Os campos de junção e de anonimização passam a ser gravados só pelas funções
do servidor: ninguém consegue desfazer uma anonimização pela API do banco.

Nenhuma configuração precisa ser feita.
