/**
 * Feriados do atendimento (0660): feriado VENCE a jornada — inclusive a 24/7 — e a
 * estimativa de reabertura pula o dia. A regra é a mesma função pura que o
 * roteamento, o roster e o motor usam (`isWithinSchedule`).
 */
import { describe, expect, it } from "vitest";

import { dataLocal, estaDePlantao, isAttendantEligible, isWithinSchedule } from "@/lib/routing/eligibility";
import { proximaAberturaDeUmaAgenda, proximaAberturaGeral } from "@/lib/escalacao/proxima-abertura";

const TZ = "America/Sao_Paulo";
// Jornada da Capital Code: segunda a sábado, 08–12 e 14–18 (decisão de 14/10/2026).
const JORNADA = {
  timezone: TZ,
  windows: [1, 2, 3, 4, 5, 6].flatMap((dow) => [
    { dow, start: "08:00", end: "12:00" },
    { dow, start: "14:00", end: "18:00" },
  ]),
};

// 2026-11-02 é segunda-feira e Finados. 10h de Brasília = 13h UTC.
const SEGUNDA_FINADOS_10H = new Date("2026-11-02T13:00:00Z");

describe("isWithinSchedule com feriados", () => {
  it("sem feriado, segunda 10h está no horário", () => {
    expect(isWithinSchedule(JORNADA, SEGUNDA_FINADOS_10H)).toBe(true);
  });

  it("⭐ feriado no dia: fora do horário, mesmo dentro da janela", () => {
    expect(isWithinSchedule({ ...JORNADA, feriados: ["2026-11-02"] }, SEGUNDA_FINADOS_10H)).toBe(false);
  });

  it("feriado vence também a jornada 24/7 (a equipe inteira está fora)", () => {
    expect(isWithinSchedule({ timezone: TZ, windows: [], feriados: ["2026-11-02"] }, SEGUNDA_FINADOS_10H)).toBe(false);
    expect(isWithinSchedule({ timezone: TZ, windows: [] }, SEGUNDA_FINADOS_10H)).toBe(true);
  });

  it("o dia é o LOCAL do fuso da jornada, não o UTC", () => {
    // 01/11 23h de Brasília = 02/11 02h UTC: ainda é dia 01 no fuso da jornada.
    const domingoNoite = new Date("2026-11-02T02:00:00Z");
    expect(dataLocal(domingoNoite, TZ)).toBe("2026-11-01");
  });

  it("plantão e elegibilidade herdam a regra", () => {
    const agenda = { ...JORNADA, feriados: ["2026-11-02"] };
    expect(estaDePlantao({ isAvailable: true, schedule: agenda }, SEGUNDA_FINADOS_10H)).toBe(false);
    expect(isAttendantEligible({ isAvailable: true, capacity: 5, currentLoad: 0, schedule: agenda }, SEGUNDA_FINADOS_10H)).toBe(false);
  });
});

describe("próxima abertura pula o feriado", () => {
  it("sábado 19h com segunda feriado: abre terça 08h (domingo não tem janela)", () => {
    const sabado19h = new Date("2026-10-31T22:00:00Z");
    const abre = proximaAberturaDeUmaAgenda({ ...JORNADA, feriados: ["2026-11-02"] }, sabado19h);
    expect(abre?.toISOString()).toBe("2026-11-03T11:00:00.000Z");
  });

  it("sem feriado, a mesma consulta abre segunda 08h", () => {
    const sabado19h = new Date("2026-10-31T22:00:00Z");
    expect(proximaAberturaDeUmaAgenda(JORNADA, sabado19h)?.toISOString()).toBe("2026-11-02T11:00:00.000Z");
  });

  it("almoço num dia normal: volta às 14h do mesmo dia", () => {
    const terca1230 = new Date("2026-11-03T15:30:00Z");
    expect(proximaAberturaGeral([{ ...JORNADA, feriados: ["2026-11-02"] }], terca1230)?.toISOString()).toBe(
      "2026-11-03T17:00:00.000Z",
    );
  });

  it("emenda longa (Carnaval) ainda acha a abertura", () => {
    const feriados = ["2027-02-06", "2027-02-08", "2027-02-09", "2027-02-10"];
    const sexta19h = new Date("2027-02-05T22:00:00Z");
    expect(proximaAberturaDeUmaAgenda({ ...JORNADA, feriados }, sexta19h)?.toISOString()).toBe("2027-02-11T11:00:00.000Z");
  });
});
