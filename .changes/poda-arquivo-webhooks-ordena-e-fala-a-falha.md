---
impacto: nada_mudou
secao: corrigido
titulo: A poda do arquivo de webhooks passa a ordenar o lote e a dizer quando falha
---

A limpeza automática do arquivo de webhooks passou a apagar em lotes
**ordenados** (pelo identificador, do mais antigo ao mais novo — a mesma ordem
que a limpeza do histórico de captação já usa) e a falha do banco deixou de ser
engolida: ela sobe, responde 500, grava a linha `falhou` na trilha e chega ao
Sentry — em vez de virar um "não havia nada para apagar" que não era verdade.

A ordem não é enfeite. O banco de dados usado nas instalações novas recusa
apagar um lote sem ordem definida, e nenhuma linha do arquivo era removida —
com o arquivo sendo 468 MB de um banco de 545 MB medido numa instalação real,
crescendo ~23 MB/dia contra o teto de 500 MB do plano gratuito. Onde a
limpeza funcionava, a ordem torna o ritmo de esvaziamento reproduzível: hoje
ela apaga sempre as mesmas linhas mais antigas primeiro.

Sem ação para quem opera: as duas tabelas, os dois prazos e o tamanho do lote
são os mesmos. O efeito é que uma instalação em que o banco recusa a limpeza
passa a ser vista — na trilha e no Sentry — em vez de acumular arquivo em
silêncio.
