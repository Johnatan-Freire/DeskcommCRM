/**
 * Trava anti-loop da conversa (auditoria de agentes): a IA não repete a mesma
 * mensagem nesta conversa, e conversa em que ela já falou demais na última hora
 * passa para a equipe. Regra pura em lib/agent-engine/agent/anti-loop.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  decidirAntiLoop,
  semelhanca,
  TETO_DE_MENSAGENS_DA_IA_POR_HORA,
  type MensagemDaConversa,
} from "@/lib/agent-engine/agent/anti-loop";

const AGORA = new Date("2026-10-15T13:00:00Z");
const ia = (body: string, minutosAtras = 5): MensagemDaConversa => ({
  direction: "outbound",
  sender_kind: "ai",
  body,
  sent_at: new Date(AGORA.getTime() - minutosAtras * 60_000).toISOString(),
});
const lead = (body: string): MensagemDaConversa => ({ direction: "inbound", body });

const PERGUNTA = "Qual curso você tem interesse em fazer: Excel, Informática Básica ou Programação?";

describe("repetição", () => {
  it("1ª tentativa de repetir: recusa e ensina o modelo", () => {
    const d = decidirAntiLoop({ candidato: PERGUNTA, historico: [ia(PERGUNTA), lead("oi")], agora: AGORA, recusasNoTurno: 0 });
    expect(d).toMatchObject({ acao: "recusar_repeticao" });
  });

  it("⭐ 2ª tentativa no mesmo turno: passa para a equipe", () => {
    const d = decidirAntiLoop({ candidato: PERGUNTA, historico: [ia(PERGUNTA)], agora: AGORA, recusasNoTurno: 1 });
    expect(d).toMatchObject({ acao: "passar_para_equipe", motivo: "repeticao" });
  });

  it("pontuação, caixa e acento diferentes ainda são a mesma mensagem", () => {
    expect(semelhanca(PERGUNTA, "qual curso voce tem interesse em fazer excel informatica basica ou programacao")).toBe(1);
  });

  it("resposta nova (informação diferente) sai normalmente", () => {
    const d = decidirAntiLoop({
      candidato: "O curso de Excel tem 40 horas, aulas à noite, e custa R$ 600 em 3 parcelas.",
      historico: [ia(PERGUNTA)],
      agora: AGORA,
      recusasNoTurno: 0,
    });
    expect(d).toEqual({ acao: "enviar" });
  });

  it("texto curto ('Perfeito!', 'Combinado') não conta como loop", () => {
    expect(decidirAntiLoop({ candidato: "Perfeito!", historico: [ia("Perfeito!")], agora: AGORA, recusasNoTurno: 0 })).toEqual({ acao: "enviar" });
  });

  it("repetir o que um ATENDENTE disse não é a IA em loop", () => {
    const humano: MensagemDaConversa = { direction: "outbound", sender_kind: "human_agent", body: PERGUNTA };
    expect(decidirAntiLoop({ candidato: PERGUNTA, historico: [humano], agora: AGORA, recusasNoTurno: 0 })).toEqual({ acao: "enviar" });
  });

  it("só as 3 últimas da IA contam: o que foi dito há muito tempo pode voltar", () => {
    const historico = [ia(PERGUNTA, 50), ia("Mensagem A sobre horários da turma noite", 40), ia("Mensagem B sobre valores e parcelas do curso", 30), ia("Mensagem C sobre certificado e carga horária", 20)];
    expect(decidirAntiLoop({ candidato: PERGUNTA, historico, agora: AGORA, recusasNoTurno: 0 })).toEqual({ acao: "enviar" });
  });
});

describe("conversa travada", () => {
  it(`⭐ ${TETO_DE_MENSAGENS_DA_IA_POR_HORA} mensagens da IA na última hora: passa para a equipe`, () => {
    const historico = Array.from({ length: TETO_DE_MENSAGENS_DA_IA_POR_HORA }, (_, i) => ia(`resposta diferente número ${i} sobre o assunto`, i * 3));
    expect(decidirAntiLoop({ candidato: "mais uma resposta nova", historico, agora: AGORA, recusasNoTurno: 0 })).toMatchObject({
      acao: "passar_para_equipe",
      motivo: "conversa_travada",
    });
  });

  it("as mesmas mensagens espalhadas por mais de uma hora não travam", () => {
    const historico = Array.from({ length: TETO_DE_MENSAGENS_DA_IA_POR_HORA }, (_, i) => ia(`resposta diferente número ${i} sobre o assunto`, 30 + i * 10));
    expect(decidirAntiLoop({ candidato: "mais uma resposta nova e diferente", historico, agora: AGORA, recusasNoTurno: 0 })).toEqual({ acao: "enviar" });
  });
});

describe("o turno aplica", () => {
  const fonte = readFileSync("lib/agent-engine/agent/inbound-turn.ts", "utf8");
  it("antes de enviar, com o histórico da conversa; passar para a equipe usa a passagem do sistema", () => {
    const i = fonte.indexOf("const antiLoop = decidirAntiLoop({");
    expect(i).toBeGreaterThan(0);
    const trecho = fonte.slice(i, i + 1200);
    expect(trecho).toContain("historico: openingContext.context.messages");
    expect(trecho).toContain("await passarParaAEquipePeloSistema(antiLoop.porQue)");
    expect(fonte.indexOf("const antiLoop = decidirAntiLoop({")).toBeLessThan(fonte.indexOf("RESPOSTA OBSOLETA: o cliente escreveu de novo"));
  });
});
