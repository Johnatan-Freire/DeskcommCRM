---
impacto: nada_mudou
secao: corrigido
titulo: O número de uma conexão removida volta a poder receber os avisos
---

Ao remover uma conexão de WhatsApp, o número dela continuava sendo recusado como
destino do aviso de caso, com a mensagem "Esse é um dos números conectados da sua
conta". A verificação contava a conexão ARQUIVADA como se ela ainda estivesse
ativa — e, como a conexão que já teve um agente publicado não pode ser apagada, o
número ficava bloqueado para sempre. Agora a verificação considera apenas as
conexões ativas. O número de uma conexão em uso continua recusado, que é o que
evita um aviso respondendo ao outro sem parar.
