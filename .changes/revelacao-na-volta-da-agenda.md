---
impacto: nada_mudou
secao: corrigido
titulo: Voltar e avançar numa spec e2e também esperam a revelação da página
---

A suíte de e2e passa a esperar o streaming SSR terminar de revelar a página também depois de voltar (`goBack`) e avançar (`goForward`), como carregar e recarregar já esperavam desde o #1706; uma spec que volta a uma tela deixa de poder achar a cópia escondida da revelação e reprovar sozinha.

Nada a fazer para quem já roda o sistema: a mudança é na suíte de testes, e o aplicativo se comporta exatamente como antes.

Contribuição de @webtecnica (#884).
