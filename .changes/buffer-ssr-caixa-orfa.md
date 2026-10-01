---
impacto: nada_mudou
secao: corrigido
titulo: A caixa de streaming SSR (S:N) ganha instrumento e porta — caixa órfã não passa mais em silêncio
---

Quando o stream do React terminava antes do revelador da caixa `S:N`, o HTML ficava com a caixa órfã pendurada no `<body>`, com uma cópia da página dentro, e todo `getByTestId` passava a casar dois elementos — sem nenhum log do navegador para apontar o problema, porque nenhuma spec escutava o console. A spec nova roda o experimento da issue em duas pernas (documento servido SEM JavaScript, e página viva COM JavaScript), anexa o estado da caixa e o instrumento (`pageerror` + `console`) ao relatório em ambas, e reprova nominalmente tanto o servidor que manda dois quanto a caixa que sobra sem drenar. Não há mudança de comportamento para quem opera: isto é portão de teste, e o próximo run vermelho da classe nasce com a evidência na mão.

Contribuição de @webtecnica (#1600).
