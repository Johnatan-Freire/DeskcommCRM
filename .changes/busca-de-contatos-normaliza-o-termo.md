---
impacto: nada_mudou
secao: corrigido
titulo: A busca de contatos entende como a gente digita — e para de devolver a lista inteira
---

Quem procura um contato passa a achar mesmo digitando do jeito que se digita na pressa: **"Paulo  Lima"** com espaço duplo, **"Paulo Jr"** com as palavras separadas e **"Silva, Maria"** com ou sem vírgula encontram o cadastro, onde antes davam zero para gente que existe. Digitar **uma letra só** deixa de devolver a lista inteira dos contatos — lista inteira sob busca não é resposta, é ruído que parece resposta.

A busca de contatos passou a seguir a **mesma régua da caixa de entrada**: todo separador (espaço, vírgula, ponto e vírgula) vira o curinga da busca e o termo só vai ao banco depois de ter os dois caracteres mínimos. A régua é uma só e continua morando em `lib/inbox/termo-de-busca.ts`, então a caixa de entrada e os contatos andam juntos a partir de agora — e se a regra mudar, muda para os dois ao mesmo tempo. A busca por telefone, CPF e e-mail continua exatamente como estava, e a caixa (maiúscula/minúscula) continua sendo do banco.

A busca continua sem diferenciar acento: "Joao" ainda não encontra "João". Isso é outra fatia, porque exige coluna nova no banco e preenchimento dos cadastros existentes. Não muda esquema nenhum. Não exige ação.

Contribuição de @webtecnica (#1835).
