---
impacto: capacidade_nova
secao: corrigido
titulo: Integração seletiva do upstream até a v1.108, com as correções que a instalação nova precisava
---

Este fork recebeu, de forma seletiva, as correções e os recursos do projeto original entre a v1.80
e a v1.108. Os fragmentos de cada mudança trazida estão ao lado deste. Este fragmento descreve só o
que a própria integração acrescentou:

- **Instalação do zero:** passa a aplicar o banco inteiro sem erro. Antes, ela parava em blocos
  trazidos sem a migration correspondente e em colunas que este schema não tem.
- **Anonimização LGPD:** volta a funcionar com a marca de apagamento. A marca cobre o telefone
  principal e o identificador do WhatsApp.
- **Histórico importado:** não altera a atividade dos negócios.
- **Tabelas próprias deste fork:** avisos temporários, feriados de atendimento, configuração do
  sistema escolar e pré-matrículas recebem permissão explícita. Desde 30/10/2026 a Supabase não
  concede permissão automática a tabela nova (migration 8001).
- **Envio de mensagem com `media_url`:** recusa endereço interno do servidor, como metadata da
  nuvem, serviço interno ou loopback.
- **Dependências:** saem as vulnerabilidades críticas e altas apontadas pelo `pnpm audit`.

Nenhuma configuração precisa ser feita. Depois de atualizar, confira que o número do WhatsApp foi
liberado da trava de número novo. Se não foi, libere-o na Central.
