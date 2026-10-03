---
impacto: nada_mudou
secao: corrigido
titulo: Acesso só de leitura ao painel de plataforma deixa de escrever nas tabelas de IA, agenda, campanhas, CRM, financeiro, vendas e comissões
---
A 0508 e a primeira fatia fecharam a escrita de quem entra no painel de plataforma com `scope=support_readonly` em parte do banco, mas 45 regras de escrita criadas nos blocos seguintes ainda aceitavam a checagem que ignora o scope do JWT: agentes de IA, base de conhecimento, disponibilidade e agenda, campanhas, catálogo, funil e tarefas do CRM, honorários, sessões de voz, os moldes de lançamento recorrente, contas, formas de pagamento, plano de contas, vendas, comissões, lançamentos financeiros e fidelidade.

Agora todas exigem `scope=full` para escrever. A leitura continua como estava — `support_readonly` segue enxergando os dados, só não altera; os moldes recorrentes e as nove tabelas de dinheiro (contas, formas de pagamento, plano de contas, vendas e seus itens, regras de comissão, comissões, lançamentos e fidelidade) ganharam um par de regras (ler/escrever), porque nenhuma tinha regra de leitura própria. Membros da organização e platform admin `full` escrevem exatamente como antes.

Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art (#2115).
