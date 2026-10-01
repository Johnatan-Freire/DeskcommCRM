---
impacto: nada_mudou
secao: corrigido
titulo: O negócio só se liga a contato e responsável da própria empresa
---

Um negócio só pode apontar para um contato da mesma empresa e ter como responsável um atendente ativo dela. A regra agora vale no banco, para todo caminho que grava negócios: tela, agente, token de servidor, automação, importação, webhook de entrada, prospecção, cópia para outro funil e acesso direto à API do banco. Contato de fora recebe "Contato não encontrado", sem dizer se ele existe em outro lugar. Responsável de fora, desligado ou só leitor é recusado. Reenviar o responsável que o negócio já tem continua funcionando, mesmo que ele tenha sido desligado.

Na atualização, negócios que já apontavam para um contato de outra empresa, ou para um responsável que nunca foi membro dela, perdem esse vínculo, e a linha do tempo de cada um registra o porquê. Negócios de quem foi desligado continuam com essa pessoa como responsável. Mover um negócio de funil não falha mais quando o responsável saiu da empresa: a cópia nasce sem responsável e a linha do tempo explica.
