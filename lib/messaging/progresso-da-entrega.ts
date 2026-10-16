/**
 * O PROGRESSO DA ENTREGA SÓ ANDA PARA FRENTE — e não se perde no meio do envio.
 *
 * O WhatsApp confirma cada mensagem nossa em degraus (`ack`): 1 = o servidor
 * recebeu (um ✓), 2 = chegou no aparelho (✓✓), 3 = lida, 4 = áudio tocado. O
 * CRM mostra o degrau mais alto que ouviu.
 *
 * O defeito medido em produção (15/10/2026): toda mensagem enviada PELO CRM
 * ficava para sempre com um ✓, embora tivesse chegado. O canal manda o eco
 * (`message.any`) e o `message.ack` ~0,2 s depois do envio, enquanto o envio
 * ainda espera a resposta do canal (0,7–2,6 s medidos). Nessa janela:
 *
 *   - a linha do envio ainda não tem `external_id` — o ack não casa com ela;
 *   - o ack casa com a linha do ECO (`external_device`, mesmo id), que o envio
 *     apaga em seguida (`removerEcoDoProprioEnvio`) — o degrau vai junto;
 *   - o envio então grava `status='sent', ack=0` por cima de tudo.
 *
 * As mensagens mandadas pelo celular não sofriam: o eco delas É a linha, e o
 * ack casa com ela.
 *
 * Duas regras moram aqui, para o webhook e o envio aplicarem a MESMA:
 *   1. só ack de progresso (≥ 1) muda alguma coisa — `0`/`-1` viravam
 *      `status='sending'` e rebaixavam uma mensagem já entregue;
 *   2. o degrau é monotônico: o maior visto vence, nunca o último que chegou.
 */
import { ackToStatus, type Message } from "@/lib/types/messaging";

/** O ack só conta quando diz progresso: 1 servidor, 2 aparelho, 3 lida, 4 tocado. */
export function ackDeProgresso(ack: unknown): number | null {
  return typeof ack === "number" && Number.isInteger(ack) && ack >= 1 ? ack : null;
}

/** O degrau mais alto entre os vistos; `null` quando nenhum diz progresso. */
export function maiorAck(acks: ReadonlyArray<unknown>): number | null {
  let maior: number | null = null;
  for (const a of acks) {
    const v = ackDeProgresso(a);
    if (v !== null && (maior === null || v > maior)) maior = v;
  }
  return maior;
}

export interface CamposDoProgresso {
  ack: number;
  status: Message["status"];
  delivered_at?: string;
  read_at?: string;
}

/** As colunas que um degrau grava. */
export function camposDoAck(ack: number, agoraIso: string): CamposDoProgresso {
  const campos: CamposDoProgresso = { ack, status: ackToStatus(ack) };
  if (ack >= 2) campos.delivered_at = agoraIso;
  if (ack >= 3) campos.read_at = agoraIso;
  return campos;
}

/**
 * O que o ENVIO grava quando o canal aceita a mensagem. Sem degrau herdado é o
 * de sempre (`sent`, `ack=0`); com o degrau que o eco já tinha ouvido antes de
 * ser apagado, a linha nasce nele — o ✓✓ não some na limpeza.
 */
export function camposAoConfirmarEnvio(ackHerdado: number | null, agoraIso: string): CamposDoProgresso {
  if (ackHerdado === null || ackHerdado < 2) return { ack: ackHerdado ?? 0, status: "sent" };
  return camposDoAck(ackHerdado, agoraIso);
}

/**
 * O webhook do ack espera a linha do envio receber o id? Só se houver envio
 * nosso EM VOO na organização (sem id ainda, nascido há pouco). Sem isso, ack de
 * mensagem que o CRM nunca vai ter (grupo ignorado, histórico) seguraria o
 * webhook à toa.
 */
export const ACK_ESPERA = { tentativas: 6, intervaloMs: 600, janelaDoEnvioMs: 60_000 } as const;
