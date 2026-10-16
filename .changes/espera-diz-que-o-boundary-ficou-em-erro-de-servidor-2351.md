---
impacto: nada_mudou
secao: corrigido
titulo: A espera da revelação do e2e diz quando o boundary terminou em erro de servidor
---

Quando um boundary do streaming SSR termina em erro de servidor, o servidor não revela a caixa escondida — ele manda o cliente renderizar aquele boundary do zero. A trava da suíte de navegador reprovava esse caso com "caixa órfã de verdade", mandando procurar caixa órfã onde havia erro de servidor. É o caso medido no PR #2351: a consulta do catálogo estourava o `statement_timeout` da leitura, `app/app/products/page.tsx:95` lançava e a caixa `S:0` ficava escondida com a página já no "Algo deu errado".

A trava continua reprovando exatamente como antes — o que muda é o diagnóstico. A mensagem passa a dizer que o boundary terminou em ERRO DE SERVIDOR e a citar o `digest` do erro (mais a mensagem do servidor, quando ela vem no `data-msg` do marcador): o digest sai do `data-dgst` que o próprio `$RX` escreve no marcador do boundary, e do script `$RX("B:N","<digest>")` do stream como reserva. Quando o boundary apenas não revelou, a mensagem é palavra por palavra a de sempre.

Você não precisa fazer nada: nada muda para quem opera, nem para o tempo de espera nem para o critério de reprovação da suíte.

Contribuição de @webtecnica (#2351).
