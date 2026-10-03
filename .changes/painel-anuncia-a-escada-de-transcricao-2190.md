---
impacto: nada_mudou
secao: corrigido
titulo: O painel de Provedores mostra quem de fato ouve o áudio do cliente, e não mais whisper-1 fixo
---

O ponto "Ouvir o áudio do cliente" anunciava `whisper-1` para toda organização, inclusive para a que não tem chave OpenAI e transcreve pelo próprio modelo de conversa (por exemplo, Gemini com a chave do Google validada). O painel passa a rodar a mesma escada de transcrição do worker e mostra o degrau que vai rodar: o serviço da instalação (`TRANSCRIPTION_API_KEY`), a chave OpenAI com o modelo de transcrição em vigor, ou o modelo de conversa da organização quando ele declara a capacidade de áudio. Sem nenhum dos três, mostra "—" e o motivo, traduzido no idioma de quem usa a tela. A ordem dos degraus não mudou. Contribuição de @webtecnica (#2205, refs #2190).
