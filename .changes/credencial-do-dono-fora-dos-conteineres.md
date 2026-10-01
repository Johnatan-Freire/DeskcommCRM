---
impacto: nada_mudou
secao: corrigido
titulo: A conexão do dono do banco não entra mais no processo do CRM
---

Quem declara `SUPABASE_DB_ADMIN_URL` no `.env` (o caso de quem usa Supabase próprio e deixa a atualização rodar sozinha pelo cron) tinha essa conexão, a do dono do banco, entregue também aos contêineres `app`, `worker` e `voice-agent`, porque o compose passa o `.env` inteiro a eles. Nenhum código do CRM a usava, mas ela ficava ao alcance do processo que atende requisição. Agora esses serviços a recebem vazia, e ela continua no `.env` só para o kit (`install.sh`, `update.sh`, backup), que roda no servidor, fora dos contêineres.

Nada muda na operação: não é preciso editar o `.env` nem rodar nada, e a atualização aplica a mudança sozinha.

Contribuição de @hiro-nikaitou (#1680).
