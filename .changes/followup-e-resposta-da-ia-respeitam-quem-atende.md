---
impacto: exige_acao
secao: corrigido
titulo: A IA não responde por cima de quem assumiu, e o follow-up de silêncio só cobra a conversa do próprio agente
---

Duas correções no atendimento automático.

**Resposta da IA descartada quando alguém assume no meio.** Se um atendente
clicava em "Assumir", pausava o automático ou respondia à mão enquanto a IA
ainda estava escrevendo, a resposta dela saía assim mesmo, por cima da pessoa.
Agora a IA confere de novo, no instante do envio, se continua liberada para
falar. Se não continua, a resposta é descartada e a conversa mostra o motivo:
"uma pessoa da equipe assumiu ou pausou o atendimento enquanto a IA
respondia". O aviso ao cliente de que uma pessoa vai assumir continua saindo.
A distribuição automática de conversas entre atendentes não conta como
"assumir".

**Follow-up de silêncio só em nome de quem atendeu.** Com dois agentes no
mesmo número (por exemplo, um de vendas e um de atendimento ao aluno), o fluxo
"lead sem resposta" do agente de vendas cobrava também quem só tinha tirado uma
dúvida com o outro agente ("qual minha nota?", "8,5", e no dia seguinte "vi
que você não respondeu…"). Agora o fluxo só cobra a conversa em que a última
fala da IA saiu de um agente que marcou aquele fluxo na aba de follow-up.

## Requer atenção

Um fluxo de silêncio que **nenhum agente publicado marca** na aba de follow-up
deixa de inscrever contatos: não há agente dono da conversa para ele cobrar.
Se você usa um fluxo de silêncio assim, só com texto fixo e sem agente, abra
**IA › Agentes**, marque o fluxo no agente que atende essas conversas e
publique a versão.

Quem usa a integração com sistema escolar: o CRM passa a aceitar o aluno
encontrado só quando o sistema escolar confirma que o telefone casou pelo
**número completo** (versões antigas casavam pelos 8 últimos dígitos, e dois
DDDs diferentes com o mesmo final colidiam). Atualize o sistema escolar
**antes** do CRM. Com o CRM novo e o sistema escolar antigo, o agente não
informa dado de aluno nenhum e passa a conversa para uma pessoa.
