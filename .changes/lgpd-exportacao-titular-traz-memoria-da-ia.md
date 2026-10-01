---
impacto: nada_mudou
secao: corrigido
titulo: A exportação de dados do titular inclui a memória e os registros da IA sobre ele
---

O direito de acesso entregava conversas, leads, atividades e a ficha do titular, mas não três fontes que a cascata de anonimização já limpa a pedido dele: as notas de memória da IA (`lead_notes`), os argumentos passados às ferramentas (`ai_agent_runs.tool_calls`) e a próxima ação e a qualificação do funil (`lead_state`). O que se apaga a pedido do titular é o que se entrega a pedido dele.

A exportação agora coleta as três, filtradas por organização e contato, e as entrega no arquivo que o titular recebe (`data.json`), com a qualificação íntegra e, de cada execução da IA, o nome e os argumentos de cada ferramenta — que é o texto que o titular escreveu. O resultado das ferramentas e o texto intermediário do modelo ficam de fora: uma busca de contatos feita pelo agente devolve telefone e e-mail de outras pessoas, e isso não pode chegar ao arquivo de um titular. Quem já usa o produto recebe o relatório mais completo sem precisar fazer nada na instalação.

Refs #1965

Contribuição de @webtecnica (#1969).