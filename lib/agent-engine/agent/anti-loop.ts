/**
 * TRAVA ANTI-LOOP da conversa — puro, sem banco (auditoria de agentes, 14/10/2026).
 *
 * O `spinningGate` da cadeia de envio vigia texto idêntico em MASSA entre contatos
 * (anti-banimento). Nada vigiava a mesma conversa: o agente que não consegue
 * avançar repete a mesma pergunta ou a mesma resposta, turno após turno, e o
 * cliente recebe o eco. Duas réguas, as duas determinísticas:
 *
 *  1. REPETIÇÃO — o texto que o modelo quer mandar é quase igual (≥ 90% das
 *     palavras) a uma das últimas mensagens que a IA mandou nesta conversa. Na
 *     primeira vez no turno, volta ao modelo como erro de ENSINO; na segunda, a
 *     conversa passa para a equipe (insistir é o loop).
 *  2. CONVERSA TRAVADA — a IA já mandou muitas mensagens nesta conversa na
 *     última hora. Atendimento que precisa disso tudo não está andando: passa.
 *
 * Mensagem de humano (`sender_kind: human_agent`) não conta — repetir o que o
 * atendente disse não é a IA em loop.
 */

export const LIMIAR_DE_SEMELHANCA = 0.9;
export const ULTIMAS_MENSAGENS_COMPARADAS = 3;
export const TETO_DE_MENSAGENS_DA_IA_POR_HORA = 15;
const MINIMO_DE_PALAVRAS_PARA_COMPARAR = 4;

export interface MensagemDaConversa {
  direction: 'inbound' | 'outbound';
  sender_kind?: 'ai' | 'human_agent';
  body: string;
  sent_at?: string;
}

export type DecisaoAntiLoop =
  | { acao: 'enviar' }
  | { acao: 'recusar_repeticao'; message: string }
  | { acao: 'passar_para_equipe'; motivo: 'repeticao' | 'conversa_travada'; porQue: string };

function palavras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
}

/** Semelhança de Jaccard entre os CONJUNTOS de palavras (ordem e pontuação não importam). */
export function semelhanca(a: string, b: string): number {
  const pa = new Set(palavras(a));
  const pb = new Set(palavras(b));
  if (pa.size === 0 && pb.size === 0) return 1;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns += 1;
  return comuns / (pa.size + pb.size - comuns);
}

export function decidirAntiLoop(input: {
  candidato: string;
  historico: readonly MensagemDaConversa[];
  agora: Date;
  /** Quantas vezes ESTE turno já teve um envio recusado por repetição. */
  recusasNoTurno: number;
}): DecisaoAntiLoop {
  const daIa = input.historico.filter((m) => m.direction === 'outbound' && m.sender_kind === 'ai');

  const umaHoraAtras = input.agora.getTime() - 3600_000;
  const naUltimaHora = daIa.filter((m) => {
    if (!m.sent_at) return false;
    const t = new Date(m.sent_at).getTime();
    return Number.isFinite(t) && t >= umaHoraAtras;
  }).length;
  if (naUltimaHora >= TETO_DE_MENSAGENS_DA_IA_POR_HORA) {
    return {
      acao: 'passar_para_equipe',
      motivo: 'conversa_travada',
      porQue: `a IA já mandou ${naUltimaHora} mensagens nesta conversa na última hora sem resolver`,
    };
  }

  if (palavras(input.candidato).length < MINIMO_DE_PALAVRAS_PARA_COMPARAR) return { acao: 'enviar' };
  const recentes = daIa.slice(-ULTIMAS_MENSAGENS_COMPARADAS);
  const repete = recentes.some((m) => semelhanca(m.body, input.candidato) >= LIMIAR_DE_SEMELHANCA);
  if (!repete) return { acao: 'enviar' };

  if (input.recusasNoTurno >= 1) {
    return {
      acao: 'passar_para_equipe',
      motivo: 'repeticao',
      porQue: 'a IA tentou repetir a mesma mensagem que já tinha mandado nesta conversa',
    };
  }
  return {
    acao: 'recusar_repeticao',
    message:
      'Você já mandou essa mesma mensagem nesta conversa. NÃO repita. Responda ao que a pessoa disse ' +
      'agora com uma informação nova; se não consegue avançar, use request_human_handoff.',
  };
}
