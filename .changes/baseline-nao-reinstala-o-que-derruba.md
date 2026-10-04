---
impacto: nada_mudou
secao: corrigido
titulo: A atualização da VPS deixa de reabrir o gatilho velho da demanda e a permissão anônima das tabelas de conhecimento
---
O `baseline.sql` é reaplicado inteiro em toda atualização. Dois trechos eram reconstruídos no começo do arquivo e desfeitos no fim, e cada passada reabria a janela: o gatilho `trg_demanda_fecha_com_conversa` (substituído pelo modelo de atendimento na migration 0222) voltava a valer até ser derrubado, e quatro tabelas de conhecimento (fontes, versões, chunks e FAQ da IA) recebiam `ALL` para o papel `anon` — a chave pública do navegador — até serem revogadas adiante. Se a atualização morresse no meio, o gatilho antigo e a permissão anônima ficavam de pé até a próxima tentativa.

Agora as duas recriações saíram do texto: o gatilho não é mais reinstalado, e as quatro tabelas não são mais concedidas ao `anon` de passagem. O estado final é o mesmo de antes — nenhuma tela, nenhuma regra e nenhum dado mudam, e nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
