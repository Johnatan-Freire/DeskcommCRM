---
impacto: capacidade_nova
secao: adicionado
titulo: Os avisos que pedem gente chegam ao celular
---

Com o push ligado no aparelho (Configurações › Notificações), três avisos da
Central passam a chegar como notificação no celular, mesmo com o CRM fechado:
a IA passou uma conversa para a equipe, a IA ficou sem saldo no provedor e as
respostas estão esperando a recarga, e um negócio entrou numa etapa marcada
para avisar. São os mesmos avisos que tocam som com o site aberto; o resto da
Central continua só na tela. O texto sai no idioma da organização, sem o nome
nem o telefone do cliente, e o toque abre a conversa, o negócio ou as
credenciais. Precisa do par VAPID no `.env` (`VAPID_PUBLIC_KEY` e
`VAPID_PRIVATE_KEY`), como o push de mensagem nova; sem ele, nada muda.
Contribuição de @jmpo.
