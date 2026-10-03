---
impacto: capacidade_nova
secao: alterado
titulo: O limiar de sentimento do agente se ajusta pela tela, e o medidor de clima passa a medir hostilidade com o atendimento, não o assunto
---

A tela do agente ganha o cartão "Limiar de sentimento": a nota abaixo da qual o clima da conversa é considerado fechado e ela passa para uma pessoa. Antes, o valor só mudava por SQL direto no banco. O padrão continua 0,3, e o limiar não muda para quem não mexer nele. Nota mais alta manda mais conversas para uma pessoa; nota mais baixa deixa só a hostilidade forte acionar a passagem.

O que muda para todos os agentes, sem ajuste nenhum, é o texto do medidor de clima quando quem mede é a IA de linguagem (o caminho padrão). Ele deixou de presumir e-commerce e passa a medir hostilidade com o atendimento (ameaça, xingamento, pedido agressivo de falar com uma pessoa). Quem só descreve o problema que o trouxe, como em advocacia, saúde ou assistência técnica, fica no neutro e não aciona a passagem. Quem atende e-commerce deve ver menos passagens para uma pessoa por decepção com produto ou entrega; para voltar a passar mais conversas, suba o limiar.

Quando o clima é medido pelo Jev (Jev decidindo, ou sem IA de linguagem configurada), a escala dele não mudou e ainda lê "reclamando" abaixo de 0,3; o acompanhamento está na #2219. Contribuição de @webtecnica (#2216, refs #2209).
