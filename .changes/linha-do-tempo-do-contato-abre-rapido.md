---
impacto: nada_mudou
secao: corrigido
titulo: A linha do tempo do contato e do negócio abre em milissegundos
---

Abrir a ficha de um contato ou o dossiê de um negócio mostra o histórico de
atividades. Para decidir o que cada pessoa da equipe pode ver, o banco
conferia a permissão em **todos** os negócios da organização, um por um, mesmo
que a ficha tivesse poucos registros. Numa organização com 348 negócios, isso
custava cerca de um segundo a cada abertura e respondia por 4,5% de todo o
tempo de trabalho do banco.

Agora a permissão é calculada uma vez por consulta, do mesmo jeito que o quadro
do funil e a caixa de entrada já fazem. Com os mesmos dados, a consulta caiu de
1.061 ms para 8 ms. Quem vê o quê não muda: as regras de papel e de
visibilidade são as mesmas.

Nenhuma configuração precisa ser feita.
