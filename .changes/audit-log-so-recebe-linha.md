---
impacto: nada_mudou
secao: corrigido
titulo: O registro de auditoria não pode mais ser alterado nem apagado pela chave de serviço
---

Num projeto Supabase, a tabela de auditoria herdava do próprio Supabase a
permissão de alterar, apagar e esvaziar registros — inclusive pela chave de
serviço, que ignora as regras de acesso por organização. Na prática, quem
tivesse essa chave conseguia apagar ou reescrever um registro escolhido da
auditoria. Essas permissões foram removidas: a auditoria agora só recebe
registros novos e é lida. A limpeza legítima, que apaga apenas registros mais
antigos que o prazo de retenção configurado, continua funcionando como antes.
