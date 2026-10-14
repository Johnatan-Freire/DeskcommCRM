---
impacto: capacidade_nova
secao: adicionado
titulo: Importar o histórico do WhatsApp de um número, só como registro
---

Em Conexões, o administrador pode importar as conversas que um número do
WhatsApp teve antes de ser conectado ao CRM, escolhendo quantos dias antes da
conexão buscar (o padrão é 90). O progresso aparece no cartão do número, e a
importação pode ser cancelada a qualquer momento sem perder o que já entrou.

O histórico entra como registro e nunca como mensagem nova: nada é respondido
nem enviado, e mensagem importada não aciona agente de IA, follow-up,
automação, campanha nem notificação. Conversas que não existiam no CRM entram
fechadas, fora da Fila e da distribuição. Fotos, áudios e documentos entram só
como registro, sem o arquivo. Contatos que pediram a exclusão dos dados não
voltam.

Para funcionar, o servidor do WhatsApp precisa estar guardando o histórico do
número (armazenamento de conversas ativado), o que exige conectar o número de
novo. Sem isso, a importação avisa e não altera nada.
