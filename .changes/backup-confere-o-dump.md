---
impacto: nada_mudou
secao: corrigido
titulo: O backup só dá o banco como salvo depois de conferir que o arquivo pode ser lido
---

O backup do banco agora confere o arquivo inteiro antes de dizer que terminou. Se a gravação falhar no meio ou o arquivo sair ilegível, o backup falha e o arquivo é apagado para ninguém confiar nele, e a atualização não segue sem um backup válido. Antes, quando a gravação falhava no meio, o backup acusava a falha, mas o arquivo cortado ficava na pasta de backups junto dos bons. Contribuição de @bonito-system (#1589).
