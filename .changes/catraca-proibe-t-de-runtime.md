---
impacto: nada_mudou
secao: corrigido
titulo: O guardião do espanhol reprova t() sobre o que o operador digitou
---

A catraca de i18n passa a reprovar `t()` aplicado sobre dado que o operador
digitou — parâmetro livre de função, não chave de tradução. Foi o defeito do
PR 600: "Retorno" virando "Seguimiento". Dado de operador não é chave de
dicionário, traduzi-lo muda o dado na tela.

- 39 sítios reais (35 pares arquivo + expressão) congelados em
  `DADO_DO_OPERADOR_CONGELADO`, cada entrada com razão escrita; a lista só
  encolhe: entrada que deixa de casar com sítio é vermelho.
- Literal, tabela de módulo e wrapper passa-adireto seguem passando: nenhuma
  tela legítima começa a reprovar.
- Os cegos A e B da issue 603 ficam como próximo passo desta mesma entrega.

Contribuição de @webtecnica (#1867).
