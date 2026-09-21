---
impacto: nada_mudou
secao: corrigido
titulo: O teste da chave OpenAI para de recusar o próprio modelo padrão da instalação
---

Testar a chave de IA quando o provedor era OpenAI podia responder "chave
recusada" mesmo com uma chave válida e saldo disponível. A causa não era a
chave: o pedido de teste usava um nome de parâmetro que os modelos mais
novos da OpenAI (a partir da família GPT-5) não aceitam mais — e um desses
modelos é o padrão de instalações novas com esse provedor.

Agora o teste usa o parâmetro que a OpenAI recomenda para toda a API de
conversação, que os modelos antigos também aceitam. Quem já usa um modelo
mais antigo não percebe diferença nenhuma.

Um segundo problema apareceu ao provar o primeiro conserto contra uma conta
real: pedir só 1 token de resposta fazia o modelo gastar tudo em raciocínio
interno e devolver erro ou uma resposta vazia — de novo parecendo "chave
ruim" sem ser. O teste agora pede um pouco mais de espaço, o suficiente para
uma resposta completa.
