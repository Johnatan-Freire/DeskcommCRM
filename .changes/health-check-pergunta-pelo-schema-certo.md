---
impacto: nada_mudou
secao: corrigido
titulo: A checagem de saúde não diz mais que o banco caiu quando ele está de pé
---

Quem instala o CRM num projeto Supabase que **já servia outra aplicação**
podia ver uma atualização terminar dizendo que o app não respondeu "ok" —
com o CRM atendendo normalmente, o login abrindo e os dados todos no lugar.

A causa era da sonda, não do banco. A checagem de saúde consultava a API do
Supabase sem dizer em qual schema procurar, e aí valia o schema padrão do
projeto — que é `public` em projeto novo, mas é o de outra aplicação quando
ela chegou primeiro na lista "Exposed schemas" do painel. A sonda procurava a
tabela no lugar errado, recebia "não existe" e concluía que o banco estava
fora.

Isso importa além do susto: `update.sh` decide se a atualização deu certo por
essa resposta, e um "não" falso fazia a versão nova ser **revertida sozinha**
logo depois de instalar — sem nenhum erro aparecendo no CRM.

Agora a sonda pergunta pelo mesmo schema que o resto do app já usa
(`public`). Nada muda para quem instalou num projeto Supabase dedicado ao
CRM — nesses, a sonda já acertava por acaso, e continua acertando.
