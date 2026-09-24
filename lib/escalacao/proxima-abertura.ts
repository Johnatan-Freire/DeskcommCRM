/**
 * Quando a agenda de atendimento humano abre de novo — puro, dado (agendas,
 * agora), sem I/O.
 *
 * Existe porque `fraseDeExpectativa` (disponibilidade.ts) só sabia dizer
 * "ninguém disponível, assim que possível" — genérico demais para o caso
 * pedido pelo dono do produto: se o motivo de ninguém estar disponível é
 * horário (almoço, fora de expediente), o cliente pode ouvir UMA ESTIMATIVA
 * de verdade ("volta às 14h"), não só "assim que possível". Se o motivo for
 * capacidade cheia (alguém está NO horário mas sem folga), não há como prever
 * quando libera — cai no genérico, de propósito.
 */
import { relogioEm, instanteDoRelogio } from "@/lib/tempo/relogio-local";
import type { AvailabilitySchedule } from "@/lib/schemas/routing";

/**
 * Próxima abertura de UMA agenda estritamente depois de `now`.
 * `windows` vazio = 24/7 (mesma convenção de `isWithinSchedule`) — não há
 * "próxima abertura" que faça sentido, devolve null (o chamador não deveria
 * nem perguntar: se a agenda é 24/7 o atendente estaria elegível agora).
 * Varre até 8 dias — cobre qualquer semana com pelo menos uma janela.
 */
export function proximaAberturaDeUmaAgenda(
  schedule: Pick<AvailabilitySchedule, "timezone" | "windows">,
  now: Date,
): Date | null {
  if (schedule.windows.length === 0) return null;
  const wall = relogioEm(now, schedule.timezone);

  for (let addDays = 0; addDays <= 8; addDays += 1) {
    const dowAlvo = (wall.dow + addDays) % 7;
    const janelasDoDia = schedule.windows
      .filter((w) => w.dow === dowAlvo)
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const w of janelasDoDia) {
      const partes = w.start.split(":");
      const h = Number(partes[0]);
      const mi = Number(partes[1]);
      const candidato = instanteDoRelogio(wall.y, wall.mo, wall.d + addDays, h, mi, schedule.timezone);
      if (candidato.getTime() > now.getTime()) return candidato;
    }
  }
  return null;
}

/** A mais cedo entre as próximas aberturas de várias agendas (união dos atendentes). */
export function proximaAberturaGeral(
  schedules: Pick<AvailabilitySchedule, "timezone" | "windows">[],
  now: Date,
): Date | null {
  let melhor: Date | null = null;
  for (const schedule of schedules) {
    const candidato = proximaAberturaDeUmaAgenda(schedule, now);
    if (candidato && (!melhor || candidato.getTime() < melhor.getTime())) {
      melhor = candidato;
    }
  }
  return melhor;
}

const DIAS_DA_SEMANA_PTBR = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

/**
 * Frase INSTRUTIVA (para o modelo, não para copiar literal) descrevendo
 * quando o atendimento humano volta. "Hoje às Xh" se for o mesmo dia local;
 * "nome-do-dia às Xh" caso contrário — dá pro modelo dizer "amanhã" ou
 * "segunda-feira" sem ele ter que calcular datas sozinho, tarefa em que LLM
 * erra fuso e dia da semana com frequência.
 */
export function fraseDaProximaAbertura(proxima: Date, now: Date, timezone: string): string {
  const wallAgora = relogioEm(now, timezone);
  const wallProxima = relogioEm(proxima, timezone);
  const horaTexto = `${String(wallProxima.h).padStart(2, "0")}:${String(wallProxima.mi).padStart(2, "0")}`;
  const mesmoDia =
    wallAgora.y === wallProxima.y && wallAgora.mo === wallProxima.mo && wallAgora.d === wallProxima.d;
  const quando = mesmoDia ? `hoje às ${horaTexto}` : `${DIAS_DA_SEMANA_PTBR[wallProxima.dow]}, às ${horaTexto}`;

  return (
    `ATENÇÃO: não há ninguém da equipe disponível NESTE MOMENTO (fora do horário de atendimento). ` +
    `O atendimento humano volta ${quando} (fuso ${timezone}). Informe o cliente com essa estimativa, ` +
    `com suas próprias palavras — não prometa contato antes disso, e não invente outro horário.`
  );
}
