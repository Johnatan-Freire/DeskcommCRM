---
impacto: nada_mudou
secao: corrigido
titulo: Criar negócio direto numa etapa exigente também passa pela régua de campos obrigatórios
---

A criação de negócio (`POST /api/v1/leads`, o diálogo do Kanban com etapa escolhida, a ferramenta MCP `crm_create_lead`, a importação de planilha, a automação `create_or_move_lead` — ao criar e ao transferir entre funis — e a prospecção) passou a perguntar a mesma régua de campos obrigatórios que o arrasto, o lote, o encerramento e o clone já perguntavam. Até aqui a criação era o único caminho que nascia na etapa exigente com o campo em branco, e a cobrança só aparecia na escrita seguinte, com o negócio já lá. Agora a recusa é visível onde alguém configurou o caminho: a importação mostra a frase, e a automação fica com status de falha e a mesma frase, como já acontecia ao mover.

Os formulários de captação (webhook de entrada) seguem entrando como antes: o lead que chega de fora entra na etapa padrão da fonte mesmo que ela exija um campo que o formulário não mandou.

Nada muda para quem não configurou `obrigatorio_em` num campo do funil: a regra continua opt-in, e uma leitura indisponível das configurações deixa a criação acontecer como antes. Na transferência entre funis a recusa acontece antes de clonar e de fechar a origem, então o negócio continua aberto no funil de onde saiu.

Contribuição de @webtecnica (#2295).
