---
impacto: nada_mudou
secao: corrigido
titulo: reset-password.sh volta a encontrar o usuário
---

Quem perde o acesso a uma instalação sem SMTP — o estado normal de um
self-host recém-instalado — só tem um caminho de volta: `bash
hostgator-setup-kit/reset-password.sh <email>`. Ele não funcionava para
ninguém: qualquer endereço, existente ou não, recebia "usuário não
encontrado", porque o script pedia ao servidor de autenticação um filtro numa
sintaxe que ele não entende.

Depois de atualizar, o comando volta a funcionar. Se você já tentou usá-lo e não conseguiu, tente de novo — não precisa fazer mais nada além de atualizar.
