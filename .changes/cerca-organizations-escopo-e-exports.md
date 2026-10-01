---
impacto: nada_mudou
secao: corrigido
titulo: Cerca de escrita em organizations fecha pontos cegos de escopo léxico e exportações
---

A cerca de escrita em `organizations` (`tests/unit/escrita-em-organizations-usa-cliente-admin.test.ts`) passa a resolver a identidade do cliente admin por escopo léxico da declaração em vez de apenas pelo nome no escopo do arquivo. Além disso, funções com declaração `export { ... }`, `export default` ou que escapam como valor agora são devidamente tratadas como exportadas, impedindo que parâmetros sem anotação explícita de tipo passem desapercebidos com falso-verde.
