---
impacto: nada_mudou
secao: corrigido
titulo: O banco recusa nome de sessão WAHA acima do teto de 54, em vez de só o teste conferir
---
O teto de 54 caracteres que o WAHA impõe no nome da sessão era conferido em três lugares de código — o teste de banco, o teste unitário e a guarda antes de chamar o WhatsApp — e em nenhum deles dentro da escrita da linha. Um INSERT direto (um script, o PostgREST, ou uma migration que copiasse o corpo antigo) gravava um nome acima do teto sem que nada recusasse, e o erro só aparecia quando o operador tentava conectar o número, com o card preso em "Parado".

Agora a própria tabela `channel_sessions` recusa a linha com o mesmo código de erro das recusas de domínio da reserva: um nome novo acima de 54 não entra, e renomear uma linha para cima do teto também não. Instalação existente não é afetada — uma linha antiga com nome acima do teto continua recebendo mudanças de status, metadata e lease normalmente, porque a recusa olha apenas o nome que está sendo escrito; e o caminho de conserto (renomear para o formato curto de 45) continua cabendo na mesma linha.

De quebra, o teste de tela de pré-go-live deixa de montar `prego_` à mão e passa a usar o mesmo gerador que o banco usa, com o formato real conferido.

Contribuição de @webtecnica (#686).
