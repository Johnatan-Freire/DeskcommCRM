---
impacto: nada_mudou
secao: alterado
titulo: A exclusão de uma conexão passa a ter prova de que o aviso dela sai junto
---

O fecho do aviso quando a conexão é removida já existia na rota, mas a prova na rota só cobria o ramo que ARQUIVA. O ramo que EXCLUI de vez — canal sem histórico, o `.delete()` — seguia sem teste nenhum com aviso aberto, que é exatamente o caso descrito na issue: o operador apaga a conexão e o crítico continuava na Central. Agora há um caso de rota para esse ramo, afirmando que nenhum aviso daquela conexão sobra, que o aviso de outra conexão segue aberto e que a auditoria diz `avisos_fechados: resolvido`. Nada muda no comportamento de quem opera: só a cobertura.

Contribuição de @webtecnica (#1023).
