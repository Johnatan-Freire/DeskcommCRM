---
impacto: nada_mudou
secao: corrigido
titulo: O worker de respostas automáticas usa a chave da instalação quando a conta não tem chave
---

Numa instalação cujo provedor registrado na organização não tem chave no `.env` (o `anthropic` que o banco semeia em toda organização nova, por exemplo, enquanto o instalador coletou só `OPENAI_API_KEY`), o worker que responde sozinho pulava a mensagem do cliente com `ai_gateway_key_missing` mesmo com a chave da instalação ali — enquanto o ensaio do agente e o "Sugerir resposta" respondiam. Esse degrau agora resolve o id do modelo pelo provedor do próprio modelo no catálogo, e os três caminhos passam a concordar; id que o catálogo não conhece continua sem resposta, sem chamar o endpoint de outro provedor. Não há ação para quem opera a VPS.

Contribuição de @webtecnica (#1597).
