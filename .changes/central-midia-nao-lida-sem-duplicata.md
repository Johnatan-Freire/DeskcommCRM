---
impacto: nada_mudou
secao: corrigido
titulo: A Central para de abrir o aviso de mídia não lida em dobro quando dois workers rodam juntos
---

Quando o agente não consegue ler uma foto ou um áudio que o cliente mandou, o sistema abre um aviso na Central. Esse aviso é para ser **um por empresa** enquanto o problema durar, mas a checagem era uma pergunta e uma escrita separadas: dois workers derivando mídia no mesmo instante perguntavam "já existe aviso aberto?" antes de qualquer escrita, os dois ouviam "não", e os dois abriam um aviso. A Central ficava com dois itens idênticos, um ao lado do outro.

Agora o banco é que garante: um índice único parcial impede um segundo aviso aberto do mesmo tipo para a mesma empresa, e quem chega segundo simplesmente encontra o que já estava lá. Resolver o aviso continua liberando o próximo, e o aviso de uma empresa não interfere no de outra.

Nada é preciso fazer na instalação. Avisos repetidos que já existiam ficam com um só aberto — o mais antigo — no momento da atualização; nenhum é apagado, os demais passam a constar como resolvidos.
