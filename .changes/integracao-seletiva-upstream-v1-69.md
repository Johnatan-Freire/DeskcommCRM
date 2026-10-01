---
impacto: capacidade_nova
secao: adicionado
titulo: Correções e recursos do DeskcommCRM até a v1.69, sem mudar as regras da escola
---

O CRM recebeu, de forma seletiva, as correções e melhorias publicadas pelo projeto original
entre as versões 1.48 e 1.69 — segurança, LGPD, agentes, funil, caixa de entrada e atualização.
As regras próprias da Capital Code continuam valendo: identificação de alunos pelo Sistema
Escolar, política de cada etapa do funil, alunos que não saem de "Alunos e responsáveis",
agentes comercial e acadêmico separados e a trava geral de envio de mensagens.

Para quem opera, o que muda:

- **A retenção de mídia passa a ser cumprida.** Arquivos de mensagens mais velhos que a retenção
  da organização (365 dias) e arquivos que nada mais usa saem do armazenamento. A mensagem fica.
- **Anonimizar um contato (LGPD) alcança mais dados** — memória e registros da IA, transcrição de
  áudio e notas internas —, e o relatório de acesso do titular passa a entregá-los.
- **No funil:** campos exigidos por etapa, motivos de perda com categoria, chance de fechamento por
  etapa e aviso na Central quando um negócio entra numa etapa.
- **Na caixa de entrada:** busca dentro da conversa, link direto para cada conversa e filtro por
  várias etiquetas.
- **Nos agentes:** a resposta que ficou desatualizada porque o cliente escreveu de novo não é
  enviada, a mesma mensagem não recebe duas respostas, e o tempo de espera antes de responder é
  ajustável.

O registro completo, PR a PR, está em `docs/upstream/integracao-v1.69.md`.
