---
impacto: capacidade_nova
secao: adicionado
titulo: Cada etapa do funil pode definir quem atende o contato — e travar a saída
---

Uma etapa do funil agora pode dizer, em regra do sistema e não em instrução para
a IA, quem pode atender o contato que está nela:

- **comercial** (o padrão, e o de toda etapa que já existia): atendimento
  automático comercial e follow-up, como sempre;
- **terminal** (ex.: desistiu, desqualificado): nenhuma IA e nenhum follow-up;
- **só humano** (ex.: equipe, professores, quem pede a recepção): nenhuma IA e
  nenhum follow-up;
- **acadêmica** (ex.: alunos e responsáveis): só o agente marcado como
  acadêmico atende, e nenhum follow-up comercial.

Uma etapa também pode ser **travada**: o contato que entra nela não sai por
nenhum caminho — tela, API, MCP, IA, automação ou passagem para humano.

O agente de IA ganha um escopo (comercial ou acadêmico) e uma permissão própria
para mover o contato no funil. Agente acadêmico nunca move o funil.

O funil também pode existir **sem etapa de ganho**: tirar a marcação de ganho
de uma etapa deixou de ser recusado.

Nada muda sozinho numa instalação existente: toda etapa continua comercial e
destravada, e todo agente continua comercial, até alguém configurar outra coisa.
