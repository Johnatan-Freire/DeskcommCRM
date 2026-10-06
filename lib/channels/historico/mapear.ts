/**
 * Do payload do WAHA para o que `fn_importar_conversa_historica` recebe.
 *
 * Usa a MESMA leitura de payload da ingestão ao vivo (`lib/waha/payload.ts`):
 * identidade do chat, tipo, corpo e telefone alternativo. Uma segunda régua de
 * leitura divergiria da primeira — e a divergência apareceria como contato
 * duplicado entre o histórico e o ao vivo.
 *
 * O banco revalida tudo (janela, corte, tipo, corpo vazio); aqui só se descarta
 * o que nem chega a ser mensagem de um contato.
 */
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import type { WahaPayload } from "@/lib/waha/envelope";
import {
  bodyOf,
  dataDoTimestamp,
  mediaMimeOf,
  mediaUrlOf,
  parseChatId,
  resolveMessageType,
  telefoneAlternativoDe,
} from "@/lib/waha/payload";

const SEM_DATA = "sem_data";

export interface ContatoParaImportar {
  kind: "phone" | "lid";
  phone: string | null;
  lid: string | null;
  chat_id: string;
  notify_name: string | null;
}

export interface MensagemParaImportar {
  external_id: string;
  from_me: boolean;
  type: string;
  body: string | null;
  sent_at: string;
  has_media: boolean;
  media_mime: string | null;
  raw_type: string | null;
}

/**
 * Só chat de PESSOA vira contato. Grupo, status, transmissão e canal ficam de
 * fora — os mesmos que a sessão já ignora ao vivo.
 */
export function contatoDoChat(
  chatId: string,
  nome: string | null,
  mensagens: readonly WahaPayload[] = [],
): ContatoParaImportar | null {
  const parsed = parseChatId(chatId);
  if (parsed.kind === "phone") {
    return { kind: "phone", phone: canonicalPhoneBR(parsed.phone), lid: null, chat_id: chatId, notify_name: nome };
  }
  if (parsed.kind === "lid") {
    // O telefone real de um chat `@lid` só vem dentro das mensagens.
    const alt = mensagens.map(telefoneAlternativoDe).find((t): t is string => Boolean(t)) ?? null;
    return {
      kind: "lid",
      phone: alt ? canonicalPhoneBR(alt) : null,
      lid: parsed.lid,
      chat_id: chatId,
      notify_name: nome,
    };
  }
  return null;
}

/** `null` quando não é mensagem importável (sem id, sem data). */
export function mensagemParaImportar(p: WahaPayload): MensagemParaImportar | null {
  if (!p.id || typeof p.id !== "string") return null;
  // Sem horário real não há como afirmar que é anterior à conexão — o
  // `dataDoTimestamp` da ingestão cairia em "agora", e "agora" não é histórico.
  // Por isso o valor de "sem data" passado a ela é um marcador, e não o relógio.
  const sentAt = dataDoTimestamp(p.timestamp, SEM_DATA);
  if (sentAt === SEM_DATA) return null;
  return {
    external_id: p.id,
    from_me: p.fromMe === true,
    type: resolveMessageType(p),
    body: bodyOf(p),
    sent_at: sentAt,
    has_media: Boolean(p.hasMedia || mediaUrlOf(p)),
    media_mime: mediaMimeOf(p),
    raw_type: typeof p.type === "string" ? p.type : null,
  };
}
