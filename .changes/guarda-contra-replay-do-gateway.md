---
impacto: nada_mudou
secao: adicionado
titulo: Defesa extra contra um tipo raro de indisponibilidade total
---

Adicionamos uma camada de proteção contra um cenário raro observado em
produção de outra instalação: o serviço do Supabase que fica entre a
internet e o banco reexecuta automaticamente qualquer resposta de erro do
tipo "5xx" (erro do servidor), sem limite. Se algumas requisições muito
antigas ficarem presas nesse ciclo, elas podem ocupar todas as conexões
disponíveis e derrubar a instalação inteira — mesmo com o banco saudável.

Agora uma requisição reconhecidamente antiga (mais de 5 minutos) recebe uma
resposta que não é reexecutada, cortando o problema na raiz antes que ele
consuma as conexões. Nada para configurar, e nada muda no uso normal do
sistema.
