---
impacto: nada_mudou
secao: corrigido
titulo: A caixa de abas da Inbox volta a ser barata em instalação grande — a RLS de contacts não é mais reavaliada por conversa
---

Abrir a Inbox e trocar de aba ficava de 1,8 a 2,2 s por contagem numa instalação com 528 conversas, porque a função que decide quem manda na conversa relia a política de isolamento de contatos duas vezes para cada conversa da lista. A partir desta versão ela roda com privilégio próprio sobre uma linha que já passou pela política da própria conversa, e devolve exatamente o mesmo texto de antes — as abas mostram as mesmas contagens. A mudança é só de desempenho no banco: nenhuma ação para quem opera, e a instalação recebe o conserto sozinha na próxima atualização.

Contribuição de @webtecnica (#1602), a partir da medição de @rogercampel (#1571).
