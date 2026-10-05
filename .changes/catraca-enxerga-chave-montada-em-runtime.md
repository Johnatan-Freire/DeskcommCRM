---
impacto: nada_mudou
secao: corrigido
titulo: A catraca do espanhol passa a enxergar a chave montada em runtime e o t() sobre variável
---

O gate que cobra a tradução em espanhol só reconhecia texto escrito no código (`t("literal")`) e tabela resolvível (`t(TABELA[k])`): quando a chave é montada em runtime (``t(`Meta de ${x} batida`)``) ou vem de uma variável que ninguém consegue ler (`t(rotulo)`), o gate ficava verde mesmo sem nada em espanhol — e, como `traduzir()` devolve a própria chave quando ela falta, a frase saía em português para quem escolheu espanhol. A catraca agora cobre as duas formas, apontando arquivo:linha de cada uma.

34 sítios já existentes foram congelados em uma lista com a razão escrita de cada um (a lista só encolhe; nenhuma tradução foi mexida) — consertar um por um é decisão de produto, e está declarado assim. Métrica e gates na PR.

Contribuição de @webtecnica (#2298, continuação da #603).
