---
impacto: nada_mudou
secao: corrigido
titulo: No quadro do funil, o total da etapa separa as moedas em vez de somá-las
---

Quando uma etapa do funil tinha negócios em moedas diferentes, o total no alto
da coluna e a linha "ponderado" somavam todos os valores e escreviam o resultado
na moeda do primeiro negócio: R$ 5.000 e 5.000 € apareciam como "R$ 10.000,00",
um valor que não existe. Agora cada moeda tem o seu total, lado a lado e sem
conversão ("R$ 5.000,00 + 5000,00 €"), com a moeda mais frequente da etapa
primeiro. Quando duas moedas usam o mesmo símbolo, como o peso mexicano e o
dólar, cada total leva o código da moeda ("$1,500.00 MXN + $100.00 USD"). Etapa
com uma moeda só continua exatamente igual. Não exige ação de quem opera a
instalação.

Levantamento de @franceschini-lucas (#1531).
