---
impacto: nada_mudou
secao: corrigido
titulo: O aviso "já acionei o time" só vai ao cliente se a IA (ou o agente conectado) atendia a conversa — e uma vez por dia
---

Numa instalação sem agente publicado, o detector de sentimento — que analisa
toda mensagem, com ou sem agente — podia passar a conversa para a equipe, e o
cliente recebia "Esse caso é melhor resolvido por uma pessoa. Já acionei o
time." sem nunca ter falado com a IA. E quando o envio travava e o disparo era
refeito, o mesmo aviso saía várias vezes seguidas.

Agora o aviso só sai quando a IA de fato falou naquela conversa antes (ou
quando foi o agente conectado por MCP quem pediu a passagem), e no máximo uma
vez por conversa a cada 24 horas. Um aviso que falhou no envio não conta: o
cliente nunca o recebeu, e o próximo sai. A passagem para a equipe continua
acontecendo do mesmo jeito; só a frase ao cliente deixa de sair quando não faz
sentido.

Contribuição de @jmpo (#1818).
