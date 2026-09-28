---
impacto: nada_mudou
secao: corrigido
titulo: O assistente não grava mais no negócio de outro cliente
---

Quando o assistente anota algo num negócio durante uma conversa (valor, campos, etapa), ele informa qual negócio é — e às vezes informa errado. Medido em produção em 15 de setembro: o cliente respondeu "sim, já tenho os textos", o assistente tentou anotar num negócio que não existia, a anotação foi recusada e a resposta se perdeu. O caso pior não chegava a dar erro: se o código informado fosse de um negócio real de **outro** cliente, no mesmo funil, a anotação era aceita e ia para a ficha errada.

Agora toda anotação do assistente numa conversa é conferida contra os negócios da pessoa com quem ele está falando. Se o negócio informado é dessa pessoa, segue. Se não é e ela tem um único negócio aberto, a anotação vai para ele. Com nenhum ou com vários abertos, o assistente recebe a recusa com o motivo e segue a conversa, em vez de escolher por palpite. Anotações feitas por pessoas, pela API ou por automações não mudam. Crédito: @paulolimajr77.
