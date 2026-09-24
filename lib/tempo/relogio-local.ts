/**
 * Hora de parede tz-aware, e o caminho inverso (hora de parede → instante
 * UTC), sem dependência — via `Intl.DateTimeFormat`, correto sob DST.
 *
 * Extraído de `lib/agent-engine/pacing/engine.ts` (que consumia isto como
 * função privada) porque `lib/escalacao/proxima-abertura.ts` precisa do
 * MESMO par: janela de pacing e janela de atendente são domínios diferentes,
 * mas "que horas são nesse fuso" e "que instante é 14h nesse fuso" são a
 * MESMA conta — duplicá-la seria duas chances de o cálculo de DST divergir
 * sem ninguém notar.
 */

export interface RelogioLocal {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** 0=domingo … 6=sábado — mesma convenção de `scheduleWindowSchema.dow`. */
  dow: number;
}

const DOW_POR_ABREVIACAO: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Hora de parede de `instant` no fuso `timezone`. */
export function relogioEm(instant: Date, timezone: string): RelogioLocal {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return {
    y: Number(get("year")),
    mo: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")) % 24, // algumas ICU rendem '24' à meia-noite
    mi: Number(get("minute")),
    s: Number(get("second")),
    dow: DOW_POR_ABREVIACAO[get("weekday")] ?? 0,
  };
}

/**
 * Instante UTC cuja hora de parede na tz é (y, mo, d, h:mi) — técnica
 * clássica de duas passadas pelo offset (correta inclusive sob DST).
 */
export function instanteDoRelogio(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timezone: string,
): Date {
  const targetAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = targetAsUtc;
  for (let i = 0; i < 2; i += 1) {
    const w = relogioEm(new Date(guess), timezone);
    const guessAsUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    guess += targetAsUtc - guessAsUtc;
  }
  return new Date(guess);
}
