---
impacto: capacidade_nova
secao: adicionado
titulo: Criar negócio para um contato que já tem outro aberto no mesmo funil agora avisa, sem bloquear
---

Na tela do funil, o diálogo de novo negócio para no aviso, com link para o negócio aberto, e pergunta se deve criar mesmo assim; recusar não cria nada. Pelo Inbox, o aviso chega depois da criação. A API POST /api/v1/leads continua criando e devolvendo 201, e acrescenta meta.avisos=["negocio_aberto_existente"] e meta.negocio_aberto_existente {id,title}. Funil diferente ou negócio encerrado não avisam. Nenhuma mudança de banco.

Contribuição de @webtecnica (#2218, refs #1751).
