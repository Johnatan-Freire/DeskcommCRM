---
impacto: nada_mudou
secao: alterado
titulo: A checagem de permissão das rotas espera uma ida à rede a menos
---

Toda rota protegida por papel consultava primeiro o papel da pessoa no banco e,
só depois da resposta, perguntava ao serviço de login se a sessão devia a
verificação em duas etapas. As duas leituras agora saem juntas, e a espera
passa a ser a da mais lenta, não a soma das duas.

As respostas não mudam: quem não tem papel suficiente continua recebendo a
recusa por falta de papel, sem que a verificação em duas etapas seja olhada; e
uma falha ao ler a verificação continua impedindo o acesso quando ela seria
exigida. Nada fica guardado entre uma requisição e outra.

Contribuição de @gustavorodcruz96 (#1793).
