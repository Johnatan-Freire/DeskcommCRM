---
impacto: nada_mudou
secao: corrigido
titulo: A etiqueta somada por uma automação não é mais apagada pela regra que rodou ao mesmo tempo
---

A ação "adicionar etiqueta" gravava a lista de etiquetas que o aplicativo tinha montado a partir de uma leitura anterior. Quando dois eventos diferentes do mesmo negócio (ou do mesmo contato) eram processados ao mesmo tempo — um pelo laço do agente, outro pelo dreno de eventos —, as duas execuções liam a mesma lista e cada uma gravava a sua versão inteira; a última apagava a etiqueta que a outra tinha acabado de acrescentar, sem erro e sem registro. Era o caso que sobrava depois da correção anterior, que resolveu apenas as duas regras do mesmo evento.

Agora quem soma as etiquetas é o próprio banco: numa única instrução, a lista gravada recebe as etiquetas que faltavam e devolve o resultado, e a segunda execução recalcula sobre o que a primeira gravou em vez de sobrescrever com a foto antiga. A automação passa a anunciar exatamente o que ficou gravado — e só anuncia quando alguma etiqueta entrou de verdade. Nenhuma configuração nova, nenhum passo manual: instalações existentes recebem a correção na atualização.
