/**
 * Texto CUSTOMER-FACING do ramo determinístico de handoff (sem LLM) — o
 * cliente que escreve "quero falar com atendente" fora do horário passa a
 * receber uma confirmação com estimativa real, em vez de silêncio total.
 */
import { describe, expect, it } from "vitest";

import { textoDeConfirmacaoDeHandoff } from "@/lib/escalacao/texto-de-confirmacao";
import type { QuemPodeAssumir } from "@/lib/escalacao/disponibilidade";

const TZ = "America/Sao_Paulo";
/** Quarta 13h local (16h UTC) — fora da janela 08-12/14-18 (no intervalo do almoço). */
const AGORA = new Date("2026-07-29T16:00:00Z");

function q(over: Partial<QuemPodeAssumir>): QuemPodeAssumir {
  return { disponiveis: 0, total: 1, motivoEHorario: false, agendas: [], ...over };
}

describe("textoDeConfirmacaoDeHandoff — nunca vaza instrução interna", () => {
  const AGENDA = { timezone: TZ, windows: [{ dow: 3, start: "14:00", end: "18:00" }] };

  it("com alguém disponível: confirma sem falar em horário", () => {
    const t = textoDeConfirmacaoDeHandoff(q({ disponiveis: 1 }), AGORA, TZ, "lead-1");
    expect(t).toMatch(/consultor/i);
    expect(t).not.toMatch(/ATENÇÃO|NÃO prometa/);
  });

  it("motivoEHorario com próxima abertura: menciona a hora real, não 'assim que possível' genérico", () => {
    const t = textoDeConfirmacaoDeHandoff(q({ motivoEHorario: true, agendas: [AGENDA] }), AGORA, TZ, "lead-1");
    expect(t).toMatch(/14:00/);
    expect(t).not.toMatch(/ATENÇÃO|NÃO prometa|com suas próprias palavras/);
  });

  it("sem motivoEHorario (fila cheia): cai no genérico honesto, sem inventar horário", () => {
    const t = textoDeConfirmacaoDeHandoff(q({ motivoEHorario: false, agendas: [AGENDA] }), AGORA, TZ, "lead-1");
    expect(t).not.toMatch(/\d{2}:\d{2}/);
    expect(t).toMatch(/consultor|equipe/i);
  });

  it("motivoEHorario true mas sem agenda computável: cai no genérico (não quebra)", () => {
    const t = textoDeConfirmacaoDeHandoff(q({ motivoEHorario: true, agendas: [] }), AGORA, TZ, "lead-1");
    expect(t).not.toMatch(/\d{2}:\d{2}/);
  });

  it("seeds diferentes podem escolher variantes diferentes (não é sempre a MESMA frase)", () => {
    const textos = new Set(
      Array.from({ length: 20 }, (_, i) =>
        textoDeConfirmacaoDeHandoff(q({ motivoEHorario: true, agendas: [AGENDA] }), AGORA, TZ, `lead-${i}`),
      ),
    );
    expect(textos.size).toBeGreaterThan(1);
  });

  it("a mesma seed sempre escolhe a MESMA variante (estável por conversa)", () => {
    const a = textoDeConfirmacaoDeHandoff(q({ motivoEHorario: true, agendas: [AGENDA] }), AGORA, TZ, "lead-estavel");
    const b = textoDeConfirmacaoDeHandoff(q({ motivoEHorario: true, agendas: [AGENDA] }), AGORA, TZ, "lead-estavel");
    expect(a).toBe(b);
  });
});
