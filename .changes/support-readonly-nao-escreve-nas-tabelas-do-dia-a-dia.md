---
impacto: nada_mudou
secao: corrigido
titulo: Acesso só de leitura ao painel de plataforma deixa de alterar conversas, mensagens, leads, sessões de canal e convites
---
A 0508 tirou a escrita de quem entra no painel de plataforma com `scope=support_readonly`, mas só nas policies de escrita do trecho original do banco. As policies criadas nos blocos seguintes ficaram com `fn_is_platform_admin()`, que ignora o scope do JWT — então o acesso de leitura ainda alterava, pela API, as tabelas do dia a dia: conversas, mensagens, leads do funil, sessões de canal e convites de equipe.

Agora as policies de escrita dessas cinco tabelas exigem `fn_is_platform_admin_full()`. A leitura continua como estava — `support_readonly` segue enxergando os dados, só não altera. Um platform admin `full` e os membros da organização escrevem exatamente como antes.

Nada é preciso fazer na instalação; a atualização reaplica o mesmo `drop`+`create` das policies. O restante da lista da issue #2115 (as outras 36 policies, incluindo a única cuja escrita é também a única leitura) vem em fatias seguintes.

Contribuição de @Tong-bit-art (#2115).
