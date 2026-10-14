---
impacto: capacidade_nova
secao: adicionado
titulo: Correções e recursos do DeskcommCRM até a v1.80, sem mudar as regras da escola
---

O CRM recebeu, de forma seletiva, as correções e melhorias publicadas pelo projeto original
depois da versão 1.69 (até a 1.80 e os ajustes seguintes). As regras próprias da Capital Code
continuam valendo: identificação de alunos pelo Sistema Escolar, política de cada etapa do funil,
alunos que não saem de "Alunos e responsáveis", agentes comercial e acadêmico separados e a trava
geral de envio de mensagens.

Para quem opera, o que muda:

- **Funil:** visão Calendário, troca rápida de funil no título, tarefas no card do negócio e a
  intenção do roteador pode levar o card ao funil do produto (só em etapa comercial).
- **Caixa de entrada:** menção de atendentes com @ nas notas internas, respostas rápidas que usam o
  nome do contato, divisórias arrastáveis, exportar a conversa em PDF e o nome original dos
  documentos recebidos.
- **Conexões:** pausar uma conexão (e agendar a pausa com retomada automática); o aviso aparece na
  Central.
- **Follow-up:** passa a respeitar a janela de disparo também no texto fixo, não morre mais quando a
  inscrição é pausada no meio de um envio, e o STOP encerra também o follow-up pausado.
- **Atendimento:** quem assume a conversa interrompe a resposta automática que estava saindo.
- **IA:** o classificador de clima respeita o limite de gasto; o revisor de promessas acha ofertas com
  acento (matrícula, grátis).
- **LGPD e retenção:** a limpeza diária não pula mais a retomada das anonimizações quando uma poda
  falha; o CPF do contato volta a poder ser guardado cifrado.

Dois ajustes de servidor são opcionais e estão no relatório
`docs/upstream/auditoria-atualizacao-2026-10.md` (seção 8): ligar a assinatura dos webhooks do
WhatsApp e semear a chave do CPF. Sem eles, tudo funciona como hoje.
