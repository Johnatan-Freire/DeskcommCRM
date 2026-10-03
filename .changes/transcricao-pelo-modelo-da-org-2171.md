---
impacto: capacidade_nova
secao: corrigido
titulo: A transcrição de áudio usa o modelo de conversa da organização quando não há chave OpenAI, e o status da derivação nunca fica nulo
---

A nota de voz de uma organização rodando Gemini com a chave do Google validada, e sem chave da OpenAI, era recebida mas não transcrevia: o ponto `transcricao_de_audio` só falava o protocolo da OpenAI e pedia uma chave própria. A resolução virou uma escada — serviço de transcrição da instalação (`TRANSCRIPTION_API_KEY`), depois a chave OpenAI da organização ou da instalação, depois o modelo de CONVERSA da organização quando ele declara a capacidade `audio`, e no fim um "nada" legítimo com o motivo. A chave OpenAI vem antes do modelo da organização de propósito, pela mesma regra da base de conhecimento: quem já transcrevia pelo whisper não troca de fornecedor numa atualização. Vale para a nota de voz e para o áudio dos vídeos.

O segundo defeito da #2171 era o silêncio: `media_derived_status` ficava nulo quando a transcrição não existia ou falhava — "ninguém tentou" e "tentou e não deu" eram o mesmo nulo, e o dreno esperava o teto de 8 minutos por uma leitura que nunca ia chegar. Todo desfecho terminal passou a gravar `failed` ou `skipped` com o motivo em `metadata.media_derived_motivo`, inclusive quando o provedor devolve a transcrição vazia, quando o download da mídia esgota as tentativas e quando o evento de derivação nem sai. Quando a derivação desiste, a Central também abre o aviso de mídia não lida com a causa.

Contribuição de @webtecnica (#2189, refs #2171).
