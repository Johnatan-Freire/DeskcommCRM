/**
 * "Volta às 14h" em vez de "assim que possível" — pedido do dono do produto:
 * quando o handoff cai fora do horário de atendimento humano (ex.: almoço
 * 12h-14h, fora de expediente 18h-08h), o cliente ouve uma estimativa real.
 *
 * Agenda usada nos testes: seg-sáb 08h-12h e 14h-18h (a real da Capital Code,
 * ver lib/escalacao/proxima-abertura.ts). dow: 0=dom, 1=seg, ..., 6=sáb.
 */
import { describe, expect, it } from "vitest";

import {
  proximaAberturaDeUmaAgenda,
  proximaAberturaGeral,
  fraseDaProximaAbertura,
} from "@/lib/escalacao/proxima-abertura";

const TZ = "America/Sao_Paulo";

function janelasSegASab() {
  const windows = [];
  for (let dow = 1; dow <= 6; dow += 1) {
    windows.push({ dow, start: "08:00", end: "12:00" });
    windows.push({ dow, start: "14:00", end: "18:00" });
  }
  return { timezone: TZ, windows };
}

/** UTC-3 fixo (sem DST no Brasil desde 2019) — `local` em "HH:MM" vira instante UTC do mesmo dia. */
function quartaAs(hhmm: string): Date {
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 6, 29, h + 3, mi)); // 2026-07-29 é quarta-feira (dow=3)
}

describe("proximaAberturaDeUmaAgenda — agenda seg-sáb 08-12/14-18", () => {
  it("no almoço (13h): volta HOJE às 14h", () => {
    const proxima = proximaAberturaDeUmaAgenda(janelasSegASab(), quartaAs("13:00"));
    expect(proxima).not.toBeNull();
    const w = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
      proxima!,
    );
    expect(w).toBe("14:00");
  });

  it("de madrugada (02h): volta HOJE às 08h (mesmo dia, só mais cedo)", () => {
    const proxima = proximaAberturaDeUmaAgenda(janelasSegASab(), quartaAs("02:00"));
    const w = new Intl.DateTimeFormat("sv-SE", {
      timeZone: TZ,
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(proxima!);
    expect(w).toBe("29 08:00");
  });

  it("depois das 18h: volta AMANHÃ às 08h", () => {
    const proxima = proximaAberturaDeUmaAgenda(janelasSegASab(), quartaAs("19:00"));
    const w = new Intl.DateTimeFormat("sv-SE", {
      timeZone: TZ,
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(proxima!);
    expect(w).toBe("30 08:00"); // quinta
  });

  it("dentro do expediente (10h): a 'próxima' é ainda hoje (não pula pro dia seguinte)", () => {
    // Função pura não sabe que já está "dentro" — só acha a próxima abertura
    // ESTRITAMENTE depois de `now`. Quem decide se pergunta é o chamador
    // (motivoEHorario em disponibilidade.ts).
    const proxima = proximaAberturaDeUmaAgenda(janelasSegASab(), quartaAs("10:00"));
    const w = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
      proxima!,
    );
    expect(w).toBe("14:00"); // a próxima janela FUTURA é a da tarde
  });

  it("sábado à noite: pula domingo (sem janela) e volta segunda às 08h", () => {
    // 2026-08-01 é sábado; a segunda seguinte é 2026-08-03.
    const sabadoNoite = new Date(Date.UTC(2026, 7, 1, 22, 0)); // 19h local
    const proxima = proximaAberturaDeUmaAgenda(janelasSegASab(), sabadoNoite);
    const w = new Intl.DateTimeFormat("sv-SE", {
      timeZone: TZ,
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(proxima!);
    expect(w).toBe("03 08:00");
  });

  it("agenda vazia (24/7): não há 'próxima abertura' — devolve null", () => {
    expect(proximaAberturaDeUmaAgenda({ timezone: TZ, windows: [] }, quartaAs("13:00"))).toBeNull();
  });
});

describe("proximaAberturaGeral — a mais cedo entre várias agendas", () => {
  it("pega o mínimo entre duas agendas diferentes", () => {
    const cedo = { timezone: TZ, windows: [{ dow: 3, start: "13:30", end: "14:00" }] };
    const tarde = { timezone: TZ, windows: [{ dow: 3, start: "16:00", end: "17:00" }] };
    const proxima = proximaAberturaGeral([tarde, cedo], quartaAs("13:00"));
    const w = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
      proxima!,
    );
    expect(w).toBe("13:30");
  });

  it("lista vazia: null", () => {
    expect(proximaAberturaGeral([], quartaAs("13:00"))).toBeNull();
  });
});

describe("fraseDaProximaAbertura — texto instrutivo pro modelo", () => {
  it("mesmo dia: 'hoje às HH:MM'", () => {
    const agora = quartaAs("13:00");
    const proxima = quartaAs("14:00");
    const f = fraseDaProximaAbertura(proxima, agora, TZ);
    expect(f).toMatch(/hoje às 14:00/i);
    expect(f).toMatch(/não prometa contato antes disso/i);
  });

  it("dia seguinte: nome do dia da semana, não 'hoje'", () => {
    const agora = quartaAs("19:00");
    const proxima = new Date(Date.UTC(2026, 6, 30, 11, 0)); // quinta 08h local
    const f = fraseDaProximaAbertura(proxima, agora, TZ);
    expect(f).toMatch(/quinta-feira, às 08:00/i);
    expect(f).not.toMatch(/hoje/i);
  });
});
