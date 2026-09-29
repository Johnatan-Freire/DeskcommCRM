---
impacto: nada_mudou
secao: corrigido
titulo: A busca deixa de devolver a lista inteira quando o termo tem só asteriscos
---

Digitar um termo feito só de asteriscos (duplo estrela, `* *` sem espaços) na busca da caixa de
entrada ou de contatos podia devolver tudo: o asterisco não era tratado como separador e virava
curinga no `or=`, equivalente a buscar sem critério. Agora o piso da busca o ignora — um termo só
de asteriscos não vai ao banco.