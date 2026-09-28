---
impacto: nada_mudou
secao: alterado
titulo: Um gate novo compara o tipo da coluna no banco com o tipo declarado no TypeScript
---

O repositório ganhou um invariante novo, tests/invariants/tipo-de-coluna-x-typescript.test.ts,
que compara o TIPO de cada coluna lido do supabase/baseline.sql com o tipo declarado
na interface do TypeScript, nulidade incluída, e impede que o tipo de uma linha venha
através de as unknown as, que é o que desliga a checagem do compilador na hora em que
o dado entra. Ele é o irmão do vocabulario-banco-x-typescript, que compara o CHECK:
juntos cobrem as duas metades do contrato entre o banco e o código. A cobertura
inicial é a view ai_provider_credentials_safe contra a interface CredentialRow,
que é onde nasceu o achado da issue #533. Nada é transcrito de um lado para o
outro: o banco sai do baseline versionado e o TypeScript sai do próprio arquivo da
interface, e toda falha de extração passa a recusar em vez de devolver lista vazia.
Dois defeitos reais que o gate reprovara foram corrigidos junto: a coluna
api_key_last4 é NOT NULL no baseline e estava declarada como anulável no TypeScript,
e os três as unknown as CredentialRow[] das telas de Credenciais e de Agentes viraram
a asserção verificável as CredentialRow[], que o TypeScript confere. Não há ação
para quem opera a VPS.

Contribuição de @webtecnica (#1850).
