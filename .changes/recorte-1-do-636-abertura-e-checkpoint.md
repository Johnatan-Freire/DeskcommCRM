---
impacto: nada_mudou
secao: alterado
titulo: O checkpoint e a abertura do turno saem de inbound-turn.ts para um módulo próprio em abertura/
---

O arquivo inbound-turn.ts, que concentra o turno de recepção, passou a delegar a dois módulos novos dentro da mesma pasta: abertura/checkpoint.ts guarda o schema do checkpoint, o tipo da linha, a instrução de fechamento, a leitura e a gravação; abertura/ritual.ts guarda o ritual de abertura do turno (ritualBlocks e buildOpeningMessage). O inbound-turn.ts continua importando e reexportando esses símbolos, então quem já os busca por ele — os testes, o follow-up, a resposta de caso, o preview — continua achando os mesmos objetos, sem mudança de comportamento e sem mudança de caminho. A extração é a primeira das três que a issue #636 pede, feita com git mv para o histórico do arquivo acompanhar o módulo novo. Não há ação para quem opera a VPS.

Contribuição de @webtecnica (#1861).
