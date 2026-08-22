/**
 * Texto CUSTOMER-FACING de confirmação de handoff — para o ramo determinístico
 * (`inbound-turn.ts`, pedido explícito de humano detectado por regex, sem
 * passar pelo modelo). `fraseDeExpectativa` (disponibilidade.ts) NÃO serve
 * aqui: aquela é instrução PARA o modelo reformular ("diga isso com suas
 * próprias palavras"), cheia de meta-texto ("ATENÇÃO:", "NÃO prometa") que
 * vazaria pro cliente se fosse enviada direto — é o tipo exato de vazamento
 * que `internalVocabularyGate` existe pra pegar, e não dá pra contar com o
 * gate pra tapar um bug que dava pra não escrever.
 *
 * Sem modelo neste ramo (CLAUDE.md princípio 2: "enviar é sempre tool call",
 * e aqui não há turno de LLM rodando), o texto é necessariamente fixo — mas
 * com mais de uma variação por situação (mesmo espírito do "spinning de
 * copy" do anti-ban) pra não repetir a MESMA frase pra todo cliente.
 */
import type { QuemPodeAssumir } from "./disponibilidade";
import { proximaAberturaGeral } from "./proxima-abertura";
import { relogioEm } from "@/lib/tempo/relogio-local";

const DIAS_DA_SEMANA_PTBR = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

/** "ainda hoje, a partir das 14:00" ou "na segunda-feira, a partir das 08:00". */
function clausulaDeQuando(proxima: Date, now: Date, timezone: string): string {
  const wallAgora = relogioEm(now, timezone);
  const wallProxima = relogioEm(proxima, timezone);
  const horaTexto = `${String(wallProxima.h).padStart(2, "0")}:${String(wallProxima.mi).padStart(2, "0")}`;
  const mesmoDia =
    wallAgora.y === wallProxima.y && wallAgora.mo === wallProxima.mo && wallAgora.d === wallProxima.d;
  if (mesmoDia) return `ainda hoje, a partir das ${horaTexto}`;
  return `${DIAS_DA_SEMANA_PTBR[wallProxima.dow]}, a partir das ${horaTexto}`;
}

/** Escolhe entre variantes sem repetir sempre a mesma — determinístico por leadId (estável por conversa, não por turno). */
function escolhe<T>(variantes: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return variantes[h % variantes.length] as T;
}

/**
 * Mensagem pronta para envio ao lead, confirmando o handoff pedido de forma
 * explícita. `seed` (tipicamente o leadId) só varia a escolha entre as
 * variantes — não afeta o conteúdo.
 */
export function textoDeConfirmacaoDeHandoff(
  quem: QuemPodeAssumir,
  now: Date,
  timezone: string,
  seed: string,
): string {
  if (quem.disponiveis > 0) {
    return escolhe(
      [
        "Encaminhei seu atendimento para um consultor da Capital Code, que já continua por aqui com você.",
        "Já passei seu atendimento para a nossa equipe — um consultor da Capital Code assume a conversa a partir de agora.",
      ] as const,
      seed,
    );
  }

  if (quem.motivoEHorario) {
    const proxima = proximaAberturaGeral(quem.agendas, now);
    if (proxima) {
      const quando = clausulaDeQuando(proxima, now, timezone);
      return escolhe(
        [
          `Encaminhei seu atendimento para um consultor da Capital Code, que vai te apresentar a trilha ideal e orientar sobre os próximos passos. No momento estamos fora do horário de atendimento — a equipe volta ${quando} e te chama por aqui assim que possível.`,
          `Já passei seu atendimento para a nossa equipe! No momento o expediente dos consultores está fechado, mas fica tranquilo(a): voltamos ${quando} e alguém fala com você.`,
        ] as const,
        seed,
      );
    }
  }

  // Fila cheia (alguém no horário, sem folga) ou ninguém configurado/online — não há
  // horário previsível daqui, então fica no genérico honesto, sem inventar prazo.
  return escolhe(
    [
      "Encaminhei seu atendimento para um consultor da Capital Code. No momento a equipe está bem ocupada, mas assim que possível alguém continua com você por aqui.",
      "Já passei seu atendimento pra nossa equipe — pode ser que demore um pouco pra alguém responder, mas seu pedido está registrado e você vai ser atendido(a).",
    ] as const,
    seed,
  );
}
