---
impacto: nada_mudou
secao: corrigido
titulo: Anonimizar um contato também limpa a memória e os registros da IA sobre ele
---

Anonimizar um contato limpava a ficha, as conversas, as leads, as atividades e a régua, mas deixava dado pessoal em quatro lugares que o agente de IA escreve: as notas de memória (`lead_notes`), o registro de execução com os argumentos passados às ferramentas (`ai_agent_runs.tool_calls`), a próxima ação e a qualificação do funil (`lead_state`) e a identidade social do contato (`contacts.social_identity`).

As quatro fontes agora entram na cascata de anonimização. No registro de execução fica só o nome das ferramentas que rodaram, para a trilha do que o agente fez continuar legível; o texto do modelo, os argumentos e os resultados são apagados. Quem anonimiza pela ficha do contato tem tudo limpo na hora. Um pedido formal de exclusão tem essas fontes limpas na varredura diária de retenção, que já completava cascatas interrompidas. Nada precisa ser feito na instalação.

Refs #1957

Contribuição de @webtecnica (#1958).
