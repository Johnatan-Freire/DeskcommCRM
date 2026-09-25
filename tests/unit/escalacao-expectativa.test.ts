/**
 * A PROMESSA AO CLIENTE NASCE DO ESTADO REAL DA EQUIPE (ACH-03).
 *
 * O defeito que este arquivo prende foi medido num turno REAL, não deduzido: o
 * agente abriu o chamado e disse ao cliente *"vou providenciar para que alguém
 * da equipe entre em contato"* — sem prazo, sem saber se havia alguém. A
 * capacidade de consultar (`crm_list_available_attendants`) existia, estava
 * ligada e foi montada no turno (o log lista as 8 tools pelo nome). O modelo
 * simplesmente não a escolheu.
 *
 * A conclusão não foi "melhorar a descrição da tool": capacidade que depende de
 * o modelo LEMBRAR não existe metade das vezes. O caminho de escalação passou a
 * consultar sozinho e a devolver a expectativa junto com a confirmação.
 *
 * O teste é sobre a FRASE, porque é ela que decide o que o cliente ouve.
 */
import { describe, expect, it } from "vitest";

import {
  fraseDeExpectativa,
  quemPodeAssumirAgora,
  expectativaDeAtendimento,
} from "@/lib/escalacao/disponibilidade";

const AGORA = new Date("2026-08-05T15:00:00.000Z");

/** Preenche os campos novos (motivoEHorario/agendas) com o neutro — testes que não são sobre eles. */
function qBase(over: { disponiveis: number; total: number; motivoEHorario?: boolean; agendas?: never[] }) {
  return { motivoEHorario: false, agendas: [], ...over };
}

describe("a frase que o agente recebe ao escalar", () => {
  it("com gente disponível, autoriza dizer que alguém continua em seguida", () => {
    const f = fraseDeExpectativa(qBase({ disponiveis: 2, total: 4 }), AGORA);
    expect(f).toContain("2 pessoas");
    expect(f).toMatch(/pode dizer ao cliente/i);
    expect(f).not.toMatch(/NÃO prometa/);
  });

  it("uma pessoa só não vira '1 pessoas'", () => {
    expect(fraseDeExpectativa(qBase({ disponiveis: 1, total: 3 }), AGORA)).toContain("1 pessoa da equipe");
  });

  it("equipe existe mas ninguém online (motivo NÃO é horário): proíbe prometer contato imediato", () => {
    const f = fraseDeExpectativa(qBase({ disponiveis: 0, total: 4 }), AGORA);
    expect(f).toMatch(/NÃO prometa contato/i);
    expect(f).toMatch(/registrado/i);
    // A diferença entre "ninguém agora" e "ninguém nunca" importa para o texto
    // que o cliente lê — a primeira ainda promete retorno.
    expect(f).toMatch(/retorna assim que possível/i);
  });

  it("conta sem ninguém configurado: o caso da VPS recém-instalada", () => {
    // Numa instalação fresca NINGUÉM está em attendant_availability. Sem este
    // ramo, a primeira conversa de um cliente real terminaria com o agente
    // prometendo contato para o vazio.
    const f = fraseDeExpectativa(qBase({ disponiveis: 0, total: 0 }), AGORA);
    expect(f).toMatch(/ninguém configurado/i);
    expect(f).toMatch(/NÃO prometa/i);
  });

  it("as três situações produzem frases DIFERENTES", () => {
    const frases = new Set([
      fraseDeExpectativa(qBase({ disponiveis: 2, total: 4 }), AGORA),
      fraseDeExpectativa(qBase({ disponiveis: 0, total: 4 }), AGORA),
      fraseDeExpectativa(qBase({ disponiveis: 0, total: 0 }), AGORA),
    ]);
    expect(frases.size).toBe(3);
  });

  it("disponiveis===0 POR HORÁRIO (motivoEHorario) dá estimativa de volta, não só 'assim que possível'", () => {
    // AGORA = 12:00 em São Paulo (15:00Z). Janela do único atendente: 14:00-18:00.
    const f = fraseDeExpectativa(
      qBase({
        disponiveis: 0,
        total: 1,
        motivoEHorario: true,
        agendas: [{ timezone: "America/Sao_Paulo", windows: [{ dow: 3, start: "14:00", end: "18:00" }] }] as never,
      }),
      AGORA,
    );
    expect(f).toMatch(/volta.*14:00/i);
    expect(f).not.toMatch(/assim que possível/i);
  });

  it("disponiveis===0 por CAPACIDADE (motivoEHorario false) NÃO tenta estimar horário", () => {
    // Mesmo passando agendas, se motivoEHorario é false o código nem olha pra elas —
    // é o caso de "alguém está no expediente, só não tem folga na fila".
    const f = fraseDeExpectativa(
      qBase({
        disponiveis: 0,
        total: 1,
        motivoEHorario: false,
        agendas: [{ timezone: "America/Sao_Paulo", windows: [{ dow: 3, start: "10:00", end: "20:00" }] }] as never,
      }),
      AGORA,
    );
    expect(f).toMatch(/assim que possível/i);
    expect(f).not.toMatch(/volta/i);
  });
});

describe("quem pode assumir agora", () => {
  function dublePg(linhas: Array<Record<string, unknown>>) {
    return { query: () => Promise.resolve({ rows: linhas, rowCount: linhas.length }) } as never;
  }

  it("conta só quem está online, com folga e é atendente", async () => {
    const q = await quemPodeAssumirAgora(
      dublePg([
        { user_id: "a", role: "agent", is_available: true, capacity: 5, schedule: {}, carga: "2" }, // livre
        { user_id: "b", role: "manager", is_available: true, capacity: 3, schedule: {}, carga: "3" }, // lotado
        { user_id: "c", role: "agent", is_available: null, capacity: null, schedule: null, carga: "0" }, // nunca configurou
        { user_id: "d", role: "viewer", is_available: true, capacity: 9, schedule: {}, carga: "0" }, // não é atendente
      ]),
      "org",
      AGORA,
    );
    expect(q.disponiveis).toBe(1);
    expect(q.total).toBe(3);
    // a e b têm schedule {} (24/7) — mesmo com b lotado, ALGUÉM está "no horário"
    // agora, então o motivo de b não contar é fila, não horário.
    expect(q.motivoEHorario).toBe(false);
  });

  it("quem nunca configurou disponibilidade NÃO é contado como disponível", async () => {
    // O worker de roteamento também não o escolhe — contá-lo aqui prometeria o
    // que o roteamento nunca entregaria.
    const q = await quemPodeAssumirAgora(
      dublePg([{ user_id: "a", role: "agent", is_available: null, capacity: null, schedule: null, carga: "0" }]),
      "org",
      AGORA,
    );
    expect(q.disponiveis).toBe(0);
    expect(q.total).toBe(1);
    // Ninguém CONFIGURADO — não é "todo mundo fora do horário" (não há agenda
    // nenhuma pra julgar), então não tenta estimar volta.
    expect(q.motivoEHorario).toBe(false);
  });

  it("fora da janela de horário não conta, mesmo online e com folga — e o motivo É horário", async () => {
    // 15:00Z = 12:00 em São Paulo; a janela abaixo é 18:00–19:00 local.
    const q = await quemPodeAssumirAgora(
      dublePg([
        {
          user_id: "a",
          role: "agent",
          is_available: true,
          capacity: 5,
          schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 3, start: "18:00", end: "19:00" }] },
          carga: "0",
        },
      ]),
      "org",
      AGORA,
    );
    expect(q.disponiveis).toBe(0);
    // Único configurado está fora da janela agora ⇒ motivo É horário, e a
    // agenda dele volta pro chamador calcular a próxima abertura.
    expect(q.motivoEHorario).toBe(true);
    expect(q.agendas).toHaveLength(1);
  });

  it("agenda conta mesmo com is_available=false (heartbeat expirado) — não é presença, é horário declarado", async () => {
    // O atendente configurou seg-sáb 08-12/14-18 uma vez e fechou a aba —
    // AT-08 derrubou is_available pra false há muito. Time pequeno que não
    // fica com o inbox aberto o dia inteiro veria is_available quase sempre
    // falso; se a agenda dependesse dele, "volta às Xh" nunca apareceria.
    const q = await quemPodeAssumirAgora(
      dublePg([
        {
          user_id: "a",
          role: "agent",
          is_available: false,
          capacity: 5,
          schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 3, start: "18:00", end: "19:00" }] },
          carga: "0",
        },
      ]),
      "org",
      AGORA,
    );
    expect(q.disponiveis).toBe(0);
    expect(q.motivoEHorario).toBe(true);
    expect(q.agendas).toHaveLength(1);
  });

  it("alguém no horário mas sem folga: motivo NÃO é horário (não estima volta)", async () => {
    const q = await quemPodeAssumirAgora(
      dublePg([
        {
          user_id: "a",
          role: "agent",
          is_available: true,
          capacity: 1,
          // 15:00Z = quarta 12:00 em São Paulo — dentro da janela abaixo.
          schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 3, start: "08:00", end: "18:00" }] },
          carga: "1", // lotado
        },
      ]),
      "org",
      AGORA,
    );
    expect(q.disponiveis).toBe(0);
    expect(q.motivoEHorario).toBe(false);
  });

  it("leitura que falha vira instrução conservadora, nunca silêncio otimista", async () => {
    const r = await expectativaDeAtendimento(
      { query: () => Promise.reject(new Error("banco fora do ar")) } as never,
      "org",
      AGORA,
    );
    expect(r.quem).toBeNull();
    expect(r.frase).toMatch(/NÃO prometa contato/i);
  });
});
