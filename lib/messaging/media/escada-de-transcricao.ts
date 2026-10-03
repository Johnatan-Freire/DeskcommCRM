/**
 * DE ONDE VEM QUEM OUVE O ÁUDIO DO CLIENTE (#2171).
 *
 * O worker de derivação resolvia a transcrição por uma árvore de `if` que só
 * conhecia a OpenAI: sem chave OpenAI em lugar nenhum, o áudio não era
 * transcrito — mesmo para uma organização cujo MODELO DE CONVERSA já entende
 * áudio (Gemini com a chave do Google validada no painel). E o desfecho era
 * mudo: `media_derived_status` ficava nulo, o drain esperava o teto de 8
 * minutos e o turno rodava com a mensagem vazia.
 *
 * Este módulo é a ESCADA, no formato de `lib/ai/embeddings/chave.ts`: degraus
 * do mais específico ao mais genérico, cada um com a razão escrita, e um
 * `null` legítimo no fim que o chamador grava como `failed` + motivo — nunca
 * silêncio, nunca nulo.
 *
 *  1. **Serviço de transcrição da instalação** (`TRANSCRIPTION_API_KEY`) — a
 *     escolha EXPLÍCITA de transcrição do `.env`. Ignorá-la em silêncio para
 *     falar com o modelo de conversa seria trocar o fornecedor de quem já
 *     transcreve por outro, sem avisar (a mesma cautela do degrau 5 da escada
 *     de embedding, que protege quem já pagava por um provedor).
 *  2. **Padrão OpenAI-compatível** — a chave OpenAI resolvida como sempre
 *     (credencial da organização, senão a da instalação), com `whisper-1` ou
 *     `TRANSCRIPTION_MODEL`. Vem ANTES do modelo da organização pelo motivo
 *     escrito em `lib/ai/embeddings/chave.ts` (degraus 5 e 7): quem já
 *     transcrevia pela OpenAI não troca de fornecedor — nem de conta que paga —
 *     numa atualização. Vale para nota de voz e para a trilha de áudio do
 *     vídeo, que usa o mesmo transcriber.
 *  3. **Modelo de conversa da organização, quando declarar `audio`** — paga
 *     com a mesma credencial BYOK da conversa, que a organização já validou.
 *     É o degrau da #2171: a organização SEM chave OpenAI passa a ouvir o
 *     áudio. `transcreveAudio` é o registro de capacidades (`capabilities.ts`).
 *  4. **Nada** — resposta legítima, com o motivo. É o que o item 2 da issue
 *     pede: hoje "ninguém tentou" e "tentou e não deu" são o mesmo nulo.
 */
import { generateText } from "ai";

import { transcreveAudio } from "@/lib/agent-engine/edge/llm/capabilities";
import { createDefaultRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { env } from "@/lib/env";

import type { TranscriptionProvider } from "@/lib/messaging/media/transcription";
import {
  apiTranscriptionProvider,
  idiomasDaTranscricao,
  modeloDeTranscricaoEmVigor,
} from "@/lib/messaging/media/transcription";

export type OrigemDaTranscricao =
  | "servico_da_instalacao"
  | "modelo_da_organizacao"
  | "padrao_openai_compativel"
  | "nada";

/** O modelo de CONVERSA da organização, já resolvido pelo worker. */
export interface ConversaDaOrganizacao {
  provider: string;
  apiKey: string | null;
  modelId: string | null;
  baseUrl?: string | null;
}

export interface DecisaoDeTranscricao {
  origem: OrigemDaTranscricao;
  /** `null` SÓ no degrau "nada" — e aí `motivo` diz por quê. */
  transcriber: TranscriptionProvider | null;
  /**
   * Razoamento em PT-BR, pronto para `metadata.media_derived_motivo`. Sem ele
   * o operador vê `failed` e não sabe o que fazer a seguir.
   */
  motivo: string;
}

/**
 * O pedido ao modelo de conversa. Um PROVEDOR DE TRANSCRIÇÃO como os outros:
 * mesma interface `TranscriptionProvider`, só que o backend é o modelo da
 * organização em vez de `/v1/audio/transcriptions`.
 *
 * O texto pede SÓ a transcrição porque a derivação é camada universal: o
 * derivado vira `media_derived_text` e qualquer modelo de chat lê depois. Um
 * resumo ou uma resposta aqui contaminaria o turno.
 */
function promptDeTranscricao(languages: readonly string[]): string {
  const idioma =
    languages.length > 0
      ? ` O áudio está em ${languages.join(" ou ")} — transcreva nesse idioma.`
      : "";
  return `Transcreva o áudio anexado. Devolva somente o que foi falado, sem comentários, sem rótulos e sem aspas.${idioma}`;
}

export function transcricaoPeloModelo(modelo: {
  provider: string;
  modelId: string;
  apiKey: string; baseUrl?: string | null;
  languages?: readonly string[];
}): TranscriptionProvider {
  const registry = createDefaultRegistry();
  return {
    async transcribe(audio, mime) {
      const factory = registry[modelo.provider];
      if (!factory) {
        // Mesma recusa do resto da cadeia: provedor sem fábrica não transcreve,
        // e a exceção vira `failed` + motivo no worker em vez de texto vazio.
        throw new Error(`transcription_provider_unavailable: ${modelo.provider}`);
      }
      const res = await generateText({
        model: factory(modelo.apiKey, modelo.modelId, modelo.baseUrl ?? undefined),
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: audio, mediaType: mime.split(";")[0]!.trim() },
              { type: "text", text: promptDeTranscricao(modelo.languages ?? []) },
            ],
          },
        ],
      });
      return (res.text ?? "").trim();
    },
  };
}

/**
 * A escada. `chaveOpenai` é um DEGRAU com thunk: só é consultado quando o
 * serviço de transcrição da instalação não vale.
 */
export async function decidirTranscricao(entrada: {
  conversa?: ConversaDaOrganizacao | null;
  idiomas?: readonly string[];
  chaveOpenai?: () => Promise<string | null>;
}): Promise<DecisaoDeTranscricao> {
  const idiomas = entrada.idiomas ?? idiomasDaTranscricao(env.TRANSCRIPTION_LANGUAGES);

  // 1 · Serviço de transcrição da instalação — escolha explícita.
  const servico = env.TRANSCRIPTION_API_KEY;
  if (servico) {
    return {
      origem: "servico_da_instalacao",
      transcriber: apiTranscriptionProvider({
        apiKey: servico,
        baseUrl: env.TRANSCRIPTION_BASE_URL || undefined,
        model: env.TRANSCRIPTION_MODEL || undefined,
        languages: idiomas,
      }),
      motivo:
        "o serviço de transcrição configurado nesta instalação (TRANSCRIPTION_API_KEY) é o que ouve os áudios",
    };
  }

  // 2 · Padrão OpenAI-compatível — o degrau de sempre, antes do modelo da
  //     organização para ninguém trocar de fornecedor numa atualização.
  const chaveOpenai = entrada.chaveOpenai ? await entrada.chaveOpenai() : null;
  if (chaveOpenai) {
    return {
      origem: "padrao_openai_compativel",
      transcriber: apiTranscriptionProvider({
        apiKey: chaveOpenai,
        model: modeloDeTranscricaoEmVigor({
          model: env.TRANSCRIPTION_MODEL,
        apiKey: env.TRANSCRIPTION_API_KEY,
          baseUrl: env.TRANSCRIPTION_BASE_URL,
        }),
        languages: idiomas,
      }),
      motivo: "a chave OpenAI desta organização ou instalação usa o padrão de transcrição de sempre",
    };
  }

  // 3 · Modelo de conversa da organização que declara a capacidade `audio`.
  const conversa = entrada.conversa;
  if (
    conversa?.apiKey &&
    conversa.modelId &&
    transcreveAudio(conversa.provider, conversa.modelId)
  ) {
    return {
      origem: "modelo_da_organizacao",
      transcriber: transcricaoPeloModelo({
        provider: conversa.provider,
        modelId: conversa.modelId,
        apiKey: conversa.apiKey,
        baseUrl: conversa.baseUrl ?? null,
        languages: idiomas,
      }),
      motivo: `o modelo de conversa ${conversa.modelId} declara a capacidade audio e transcreve com a própria chave`,
    };
  }

  // 4 · Nada — e o motivo é do caso, não um "deu erro" genérico.
  const motivo = !conversa
    ? "não consegui resolver o modelo de conversa desta organização e não há chave OpenAI para transcrever"
    : conversa.modelId && !transcreveAudio(conversa.provider, conversa.modelId)
      ? `o modelo de conversa ${conversa.modelId} não declara a capacidade audio, e não há chave OpenAI para o serviço de transcrição`
      : "não há chave OpenAI nem modelo de conversa com capacidade audio nesta organização";
  return { origem: "nada", transcriber: null, motivo };
}
