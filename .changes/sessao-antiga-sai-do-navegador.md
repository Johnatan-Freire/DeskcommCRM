---
impacto: nada_mudou
secao: corrigido
titulo: Sessão que não renova sai do navegador em vez de repetir o erro
---

Quando o login guardado no navegador deixava de valer — por exemplo, depois
de trocar o banco da instalação — a tela mandava a pessoa para o login, mas o
cookie antigo continuava no navegador. Uma aba esquecida aberta repetia a
mesma tentativa de renovar a sessão a cada consulta, e o registro do servidor
enchia de "Invalid Refresh Token", várias vezes por minuto, por horas.

Agora a resposta que manda para o login também apaga o cookie que não serve
mais: a próxima consulta já chega sem ele e não tenta nada. Quem está com a
sessão válida não percebe diferença nenhuma.
