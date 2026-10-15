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

import { feriadosNacionaisDoAno, pontosFacultativosDoAno } from "@/lib/escalacao/feriados-do-ano";

describe("cenários da jornada seg–sáb 08–12/14–18 com feriados", () => {
  const ag = (feriados: string[]) => ({ ...JORNADA, feriados });
  const brt = (iso: string) => new Date(`${iso}-03:00`);

  it("feriado num SÁBADO (Natal 2027): sábado fora; volta segunda 08h", () => {
    const agenda = ag(["2027-12-25"]);
    expect(isWithinSchedule(agenda, brt("2027-12-25T09:00:00"))).toBe(false);
    expect(proximaAberturaDeUmaAgenda(agenda, brt("2027-12-24T18:30:00"))?.toISOString()).toBe(brt("2027-12-27T08:00:00").toISOString());
  });

  it("DOMINGO nunca está no horário, com ou sem feriado", () => {
    expect(isWithinSchedule(JORNADA, brt("2026-11-15T10:00:00"))).toBe(false);
  });

  it("VÉSPERA de feriado é dia normal até 18h", () => {
    const agenda = ag(["2026-11-02"]);
    expect(isWithinSchedule(agenda, brt("2026-10-31T17:59:00"))).toBe(true);
    expect(isWithinSchedule(agenda, brt("2026-10-31T18:00:00"))).toBe(false);
  });

  it("almoço (12h–14h) é fora do horário e a volta é às 14h", () => {
    expect(isWithinSchedule(JORNADA, brt("2026-10-15T12:30:00"))).toBe(false);
    expect(proximaAberturaDeUmaAgenda(JORNADA, brt("2026-10-15T12:30:00"))?.toISOString()).toBe(brt("2026-10-15T14:00:00").toISOString());
  });

  it("vários dias fechados (Carnaval + Cinzas cadastrada): volta no primeiro dia aberto", () => {
    const agenda = ag(["2027-02-08", "2027-02-09", "2027-02-10"]);
    expect(proximaAberturaDeUmaAgenda(agenda, brt("2027-02-06T18:30:00"))?.toISOString()).toBe(brt("2027-02-11T08:00:00").toISOString());
  });
});

describe("calendário importável", () => {
  it("feriados nacionais POR LEI de 2026, com nome — sem Carnaval nem Corpus Christi", () => {
    const d = feriadosNacionaisDoAno(2026);
    expect(d.map((x) => x.data)).toEqual([
      "2026-01-01", "2026-04-03", "2026-04-21", "2026-05-01", "2026-09-07",
      "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25",
    ]);
    expect(d.every((x) => x.tipo === "feriado_nacional" && x.descricao.length > 3)).toBe(true);
    expect(d.find((x) => x.data === "2026-04-03")?.descricao).toBe("Sexta-feira Santa");
  });

  it("2027: Sexta-feira Santa em 26/03; 20/11 cai no sábado", () => {
    const d = feriadosNacionaisDoAno(2027);
    expect(d.find((x) => x.descricao === "Sexta-feira Santa")?.data).toBe("2027-03-26");
    expect(d.some((x) => x.data === "2027-11-20")).toBe(true);
  });

  it("pontos facultativos separados: Carnaval (seg e ter) e Corpus Christi", () => {
    expect(pontosFacultativosDoAno(2026).map((x) => `${x.data} ${x.descricao}`)).toEqual([
      "2026-02-16 Carnaval (segunda-feira)",
      "2026-02-17 Carnaval (terça-feira)",
      "2026-06-04 Corpus Christi",
    ]);
    expect(pontosFacultativosDoAno(2027).map((x) => x.data)).toEqual(["2027-02-08", "2027-02-09", "2027-05-27"]);
  });
});
