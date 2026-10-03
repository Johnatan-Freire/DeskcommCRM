---
impacto: nada_mudou
secao: adicionado
titulo: As varreduras de LGPD, RLS e security definer agora veem os módulos instalados
---
As três verificações automáticas de segurança (RLS ligada, funções security definer e cascata de LGPD) rodavam sempre num banco recém-criado, sem nenhum módulo instalado. As tabelas que uma provisionadora só cria quando o módulo é instalado, portanto, não apareciam para nenhuma delas: um módulo podia nascer com tabela sem RLS, com função exposta para a chave anon ou com dado de pessoa fora da anonimização, e as verificações seguiam verdes porque simplesmente não enxergavam aquela tabela.

Um teste novo agora provisiona todos os módulos do catálogo no banco antes de rodar as três varreduras, com as regras que faltavam para módulo: toda tabela nova com organização precisa de RLS ligada e de um teste comportamental declarado, função criada na instalação não pode ser executada nem pela chave anon nem por usuário logado (só pelo servidor), e tabela com dado de pessoa precisa de seção declarada para ser alcançada pela anonimização.

Nada muda para quem opera: é uma proteção contra um erro futuro de módulo novo, não a correção de um vazamento existente.

Contribuição de @webtecnica (#2201).
