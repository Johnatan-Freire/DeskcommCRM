---
impacto: nada_mudou
secao: corrigido
titulo: O update.sh não falha mais com "duplicate key ... ai_pricing_pkey" quando um mesmo modelo está cadastrado em dois provedores
---

A atualização do aplicativo parava na etapa "Atualizando o banco de dados" com erro
`duplicate key value violates unique constraint "ai_pricing_pkey"` quando o mesmo
modelo existia ativo, com preço, em dois provedores ao mesmo tempo (ex.: openrouter
e requesty) e ainda não tinha linha em `ai_pricing`. Como `ai_models` permite um
`model_id` por provedor, o backfill de preços gerava duas linhas iguais dentro do
mesmo comando e a chave primária (que é só o `model`) recusava a segunda. O erro
não deixava nenhuma versão atualizar nem voltar com `--force` naquela instalação.

Agora o backfill emite uma única linha por modelo, escolhendo de forma determinística
o provedor de menor preço quando houver o mesmo modelo em mais de um provedor;
o mecanismo idempotente (não reescrever preço já existente) continua intacto. Quem
estava travado por esse erro basta rodar a atualização de novo: ela completa sem
ação manual no banco.

Contribuição de @webtecnica (#2008).
