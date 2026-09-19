---
impacto: nada_mudou
secao: adicionado
titulo: O canal "stable" das imagens, quando existir, passa a mover em bloco
---

Corrigimos uma falha estrutural no pipeline que publica as imagens Docker do
projeto (app, worker e scheduler), achada ao revisar o histórico de outra
instalação do mesmo software: se uma das três imagens falhasse ao construir
enquanto as outras duas terminavam com sucesso, o canal de instalação
"stable" podia acabar apontando para uma versão diferente em cada imagem —
alguém instalando por esse canal receberia serviços de versões misturadas.

Esta instalação não usa esse canal hoje (o deploy é a cada atualização do
código, direto), então isto não muda nada agora. A correção fica pronta para
o dia em que o canal "stable" for reativado.
