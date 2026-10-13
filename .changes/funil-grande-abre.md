---
impacto: nada_mudou
secao: corrigido
titulo: O quadro de um funil grande volta a abrir
---

Em funil com muitos negócios (como o de Contatos), o quadro esperava mais de 10 segundos e mostrava "Não consegui carregar este funil: A requisição não respondeu em 10000ms". A regra que decide quais negócios cada pessoa enxerga era recalculada para cada negócio, um por um; agora é calculada uma vez por abertura do quadro. Quem vê o quê não muda.
