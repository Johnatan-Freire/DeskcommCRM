---
impacto: nada_mudou
secao: corrigido
titulo: Telemetria desligada não registra mais "Invalid Sentry Dsn: off"
---

Com `SENTRY_DSN=off` — o jeito recomendado de desligar o envio de erros — o
servidor e o worker escreviam "Invalid Sentry Dsn: off" no registro a cada
vez que subiam, como se a configuração estivesse errada. O envio já estava
desligado; era só ruído no log.

Agora desligar é tratado como desligar: nenhum aviso aparece, e nada é enviado.
