---
impacto: nada_mudou
secao: corrigido
titulo: Gasto de IA sem arredondamento para cima, sentimento parado quando nenhum agente está no ar, e a frase de falta de saldo da OpenAI reconhecida
---

Três consertos medidos numa instalação real.

O custo das chamadas registradas pelos workers de sentimento e de resposta legada era arredondado para cima até o centavo inteiro. Uma classificação de sentimento, que custa cerca de um centésimo de centavo, entrava como um centavo inteiro. No mês medido, isso respondia por mais de 90% do gasto que o teto de orçamento enxergava. Agora o custo é gravado fracionado, como o motor do agente já fazia. Os registros antigos não são recalculados automaticamente. Por isso o gasto de IA mostrado em Uso e orçamento cai a partir desta versão, e o mês corrente mistura os registros antigos, arredondados, com os novos. O teto passa a disparar menos, porque deixa de contar gasto que não existiu.

Com todos os agentes pausados ou despublicados, o classificador de sentimento continuava rodando em cada mensagem recebida. A passagem para humano por sentimento mandava ao cliente "não há atendente disponível… sua conversa entrou na fila" enquanto a equipe já respondia por fora. Agora, sem agente no ar, o sentimento não roda: não cobra e não avisa ninguém.

A espera pela recarga de saldo não reconhecia a frase "You have no credits remaining" da OpenAI. Nesse caso a fila voltava a gastar as tentativas e gerava um `job_dead` por conversa. Agora a frase é reconhecida e a resposta espera a recarga como nos outros casos. Nenhuma configuração ou ação é necessária.

Contribuição de @automatikpg-ux (#1936).
