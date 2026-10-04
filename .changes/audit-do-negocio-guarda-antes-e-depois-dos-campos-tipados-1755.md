---
impacto: capacidade_nova
secao: adicionado
titulo: A auditoria da edição do negócio passa a guardar o valor anterior e o novo de valor, moeda, responsável e data prevista
---

Antes, a linha `lead.updated` do log de auditoria dizia só QUAIS campos mudaram. Agora ela também traz, em `metadata.valores`, o antes e o depois de cinco campos: valor, moeda, responsável (pessoa ou agente) e data prevista de fechamento — e só quando o campo mudou de fato. Isso permite responder "quem mudou o valor desta proposta, e de quanto para quanto?".

Título, descrição, etiquetas e campos personalizados continuam registrados só pelo nome: o log de auditoria não é reescrito pela anonimização da LGPD, então o texto livre do cliente não entra nele. Os cinco campos que entram são os mesmos que a anonimização preserva de propósito no próprio negócio. Nenhuma ação do operador.

Contribuição de @webtecnica (#2292, fecha #1755).
