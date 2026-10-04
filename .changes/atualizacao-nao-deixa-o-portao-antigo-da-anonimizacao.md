---
impacto: nada_mudou
secao: corrigido
titulo: A atualização interrompida não deixa mais de pé a versão antiga do portão de anonimização
---
O `baseline.sql` reaplica a história da função de anonimizar contato em duas definições. A intermediária, anterior à correção do #2196, ainda usava a checagem de plataforma que ignora o `scope` do JWT: se uma atualização morresse entre as duas, era essa versão que ficava no banco até a próxima passada completa, e um platform admin `support_readonly` fora de sessão de suporte voltava a poder anonimizar contato.

A definição intermediária passou a usar a guarda completa (`fn_is_platform_admin_full`, que já existe no snapshot), então o furo não fica de pé em nenhuma passada. O estado final não muda e nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
