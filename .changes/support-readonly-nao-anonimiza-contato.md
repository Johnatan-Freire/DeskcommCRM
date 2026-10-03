---
impacto: nada_mudou
secao: corrigido
titulo: Acesso só de leitura ao painel de plataforma deixa de poder anonimizar contatos
---
A 0508 tirou a escrita de quem entra no painel de plataforma com `scope=support_readonly`, mas a função de anonimizar contato (`fn_lgpd_anonymize_contact`), alcançável direto pela API, continuava aceitando esse acesso (a tela já recusava; o buraco era só a chamada direta): o portão perguntava `fn_is_platform_admin()`, que ignora o scope do JWT, e a única condição a mais — estar fora de sessão de suporte — é o estado normal de quem observa.

Agora o atalho de plataforma exige `scope=full`. Um platform admin `full` fora de suporte continua anonimizando, e o admin da própria organização continua anonimizando com MFA comprovada; só o modo de leitura deixa de escrever. É a mesma régua das issues #2000 e #2078.

Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art (#2195).
