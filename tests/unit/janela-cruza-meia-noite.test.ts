/**
 * Janela de envio que CRUZA a meia-noite (ex.: 22h até 7h do dia seguinte).
 *
 * Até esta mudança, `insideWindow` fazia `h >= start && h < end` sem checar
 * qual dos dois era maior: configurar start=22/end=7 fechava a janela pra
 * SEMPRE (nenhuma hora do dia satisfaz `h >= 22 && h < 7`), e `windowIsValid`
 * rejeitava esse par na gravação — então nem dava pra chegar nesse estado.
 * Pedido explícito do dono do produto (agente rodar 22h-07h); ver CLAUDE.md.
 */
import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { decidePacing } from "@/lib/agent-engine/pacing/engine";

const WRAP = { windowStartHour: 22, windowEndHour: 7 };

/**
 * America/Sao_Paulo = UTC-3 (sem horário de verão). Terça 2026-07-28 00h
 * local = 2026-07-28T03:00:00Z; soma em ms evita overflow de string ISO
 * quando localHour + 3 >= 24 (ex.: 23h local = 02h UTC do dia SEGUINTE).
 */
const TERCA_00H_LOCAL_UTC = Date.parse("2026-07-28T03:00:00Z");
const terca = (localHour: number, minute = 0) =>
  new Date(TERCA_00H_LOCAL_UTC + localHour * 3_600_000 + minute * 60_000);

function input(now: Date, over: Partial<typeof PACING_DEFAULTS> = {}) {
  return {
    now,
    knobs: { ...PACING_DEFAULTS, ...WRAP, ...over },
    state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
    crmDailyLimit: null,
    banRisk: false, // isola a janela do cap de warm-up
    rng: () => 0,
  };
}

describe("janela 22h-07h (start > end) — cruza a meia-noite", () => {
  it("23h local: DENTRO (depois do início, antes da meia-noite)", () => {
    expect(decidePacing(input(terca(23))).allow).toBe(true);
  });

  it("02h local: DENTRO (depois da meia-noite, antes do fim)", () => {
    expect(decidePacing(input(terca(2))).allow).toBe(true);
  });

  it("07h local exato: FORA — fim é exclusivo, igual à janela comum", () => {
    const d = decidePacing(input(terca(7)));
    expect(d.allow).toBe(false);
  });

  it("10h local: FORA (comercial, mas fora da janela noturna)", () => {
    const d = decidePacing(input(terca(10)));
    expect(d.allow).toBe(false);
    if (d.allow) return;
    expect(d.code).toBe("outside_window");
  });

  it("21h59 local: FORA, e a próxima abertura é 22h do MESMO dia", () => {
    const d = decidePacing(input(terca(21, 59)));
    expect(d.allow).toBe(false);
    if (d.allow) return;
    // 22h America/Sao_Paulo = 01h UTC do dia seguinte.
    expect(d.nextAllowedAt.getUTCHours()).toBe(1);
  });

  it("22h local exato: DENTRO (início é inclusivo)", () => {
    expect(decidePacing(input(terca(22))).allow).toBe(true);
  });

  it("controle: janela comum (7h-22h) continua funcionando após a mudança", () => {
    expect(decidePacing(input(terca(10), { windowStartHour: 7, windowEndHour: 22 })).allow).toBe(
      true,
    );
    expect(decidePacing(input(terca(23), { windowStartHour: 7, windowEndHour: 22 })).allow).toBe(
      false,
    );
  });
});
