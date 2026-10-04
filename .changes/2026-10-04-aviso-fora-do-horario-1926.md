---
impacto: capacidade_nova
secao: adicionado
titulo: Quem escreve fora do horário de atendimento pode receber um aviso configurável — uma vez por contato por período fechado
---
O turno de quem chega fora da janela do agente era adiado para a abertura sem nenhuma resposta: no sábado à noite, silêncio até segunda de manhã, e a pessoa sem saber se a mensagem chegou. Agora a tela de gatilho do agente (em "Só atender em horário de funcionamento") aceita um texto de aviso, e esse texto é enviado quando a mensagem chega fora da janela, registrado na conversa como Automação. Vale só para quem preencher o texto: o padrão é não enviar nada, e quem não mexer na tela não vê mudança nenhuma.

O aviso só sai DENTRO da janela de envio do número (por padrão 7h–22h, ajustável por canal). Quem escreve entre o fechamento dessa janela e a abertura seguinte (por padrão, das 22h às 7h) não recebe o aviso na hora: o turno fica em silêncio até a janela de envio abrir, e só então o aviso sai, se o horário de atendimento ainda estiver fechado.

Vale no máximo um aviso por contato por período fechado: o período começa quando a janela fecha e só volta a valer quando ela abre e fecha de novo: um segundo contato na mesma noite não recebe de novo, e o contato bloqueado (opt-out/`is_blocked`), o titular anonimizado e o número interno da própria organização não recebem nunca. O aviso é RESPOSTA a quem escreveu primeiro, não disparo ativo: ele respeita a janela de resposta do número, o warm-up, o teto diário e o espaçamento, e entra na contagem de envios como qualquer outro. Quando o horário de atendimento abre, a IA responde normalmente sobre a conversa que já tem o aviso.
