---
impacto: capacidade_nova
secao: adicionado
titulo: Materiais do agente — o agente de IA envia vídeo, imagem e PDF na conversa
---

Nova tela em **IA › Ensinar o agente › Materiais do agente**. Nela a equipe
sobe vídeos (MP4), imagens (JPEG ou PNG) e PDFs de até 16 MB, que é o limite do
WhatsApp para vídeo. Para cada material, escreve em que situação ele deve ser
enviado. Por exemplo: "quando o lead demonstrar interesse em Informática Básica
ou pedir para saber como é o curso".

O agente lê essas instruções junto com o resto do que sabe e, quando a conversa
chega naquela situação, envia o material com uma mensagem de legenda. O vídeo
toca dentro do WhatsApp; não é um link.

- **Sem repetição:** o mesmo material não é enviado duas vezes na mesma
  conversa. Quem garante isso é o sistema, não o prompt.
- **Por agente:** cada material pode valer para todos os agentes ou só para os
  escolhidos.
- **Desativar e remover:** desativar tira o material do atendimento sem apagá-lo.
  Remover apaga o arquivo; o que já foi enviado nas conversas continua lá.
- **Botão Testar:** mostra qual material seria enviado, sem enviar nada.
- **Arquivo que falha:** se o arquivo não puder ser anexado, o texto sai mesmo
  assim, e o agente é avisado para não dizer que mandou.

Não é preciso mexer em nada na VPS: a atualização cria a tabela e o espaço de
armazenamento privado dos materiais.
