---
impacto: capacidade_nova
secao: adicionado
titulo: A tela de Contatos passa a exportar o que ela mesma importa, em CSV e vCard
---

A tela de Contatos tinha "Importar CSV" (PR #313) e nenhuma porta de volta: o CRM aceitava dados mas não os devolvia, e o caminho único era SSH + psql — o terminal que o produto existe para eliminar. Agora o header ao lado de "Importar CSV" tem "Exportar", com dois formatos. O CSV espelha exatamente as colunas que o importer reconhece (`name`, `display_name`, `email`, `phone_number`, `cpf`, `tags`), com aspas RFC 4180 e BOM para o Excel em português ler acento: exportar e reimportar devolve as mesmas pessoas com as mesmas etiquetas, porque o arquivo é lido pelo próprio parser da tela. O vCard (`.vcf`) é o que o celular importa, Android e iOS, com `FN`, `TEL` e `EMAIL` em um arquivo só para a lista inteira — o produto já sabia ler cartão (#2712, #2742), faltava escrever.

`GET /api/v1/contacts/export?formato=csv|vcf` segue o fluxo do export de auditoria que já existia: papel antes de ler, `Content-Type` próprio e `Content-Disposition: attachment` com `contatos-YYYY-MM-DD`, paginação em blocos até 10.000 registros com o corte declarado no cabeçalho. Exporta o que a tela está mostrando — os mesmos filtros de busca, etiqueta (E/OU), origem e pessoais viajam para o mesmo handler da lista, então não existe segunda resposta para a mesma pergunta. O CPF sai em claro só para quem tem papel de gerente, decifrado pela mesma RPC que o get do contato já usa (ela audita cada chamada); sem cifra disponível a coluna sai vazia em vez de derrubar o arquivo. `audit()` registra `contacts.exported` com quem, quando, quantos registros e que filtros valiam — nunca o texto da busca, que é dado de quem foi buscado.

Nenhuma mudança de banco.

Contribuição de @webtecnica (refs #2759).
