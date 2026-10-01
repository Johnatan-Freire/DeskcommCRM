---
impacto: capacidade_nova
secao: alterado
titulo: A anonimização de um contato passa a apagar também as notas do agente, os argumentos das ferramentas da IA, a próxima ação da lead e a identidade social — direto no banco
---
Antes, o pedido de esquecimento (LGPD) só limpava a memória do agente, os argumentos de ferramentas da IA, a próxima ação da lead e o perfil social quando a camada de aplicação rodava; se a anonimização acontecesse por outro caminho (um update direto, por exemplo), essas quatro fontes ficavam com dados da pessoa. Agora a cascata do banco, disparada quando o contato vira anonimizado, redige as quatro na mesma transação: as notas da IA, o registro das ferramentas (preservando o nome da ferramenta), o estado da lead e a identidade social. Operação idempotente, então a varredura diária não reescreve o que já foi limpo.

Contribuição de @webtecnica (#1973).
