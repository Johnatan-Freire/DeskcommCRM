import { describe, expect, it } from "vitest";

import { toolsDoSistemaEscolarNoTurno } from "./sistema-escolar-gate";

describe("toolsDoSistemaEscolarNoTurno", () => {
  it("org sem config: nenhuma tool, não importa o que o agente marcou", () => {
    expect(
      toolsDoSistemaEscolarNoTurno({
        orgConfigurada: false,
        agentToolIds: ["consultar_aluno_sistema_escolar", "consultar_catalogo_cursos"],
      }),
    ).toEqual({ aluno: false, catalogo: false });
  });

  it("sem agente publicado (fallback de playbook): as duas entram juntas, como antes do escopo por agente", () => {
    expect(
      toolsDoSistemaEscolarNoTurno({ orgConfigurada: true, agentToolIds: null }),
    ).toEqual({ aluno: true, catalogo: true });
  });

  it("agente novo (lista vazia): nasce fechado — nenhuma tool", () => {
    expect(
      toolsDoSistemaEscolarNoTurno({ orgConfigurada: true, agentToolIds: [] }),
    ).toEqual({ aluno: false, catalogo: false });
  });

  it("agente marcou só consulta de aluno: catálogo fica de fora", () => {
    expect(
      toolsDoSistemaEscolarNoTurno({
        orgConfigurada: true,
        agentToolIds: ["consultar_aluno_sistema_escolar"],
      }),
    ).toEqual({ aluno: true, catalogo: false });
  });

  it("agente marcou só catálogo: consulta de aluno fica de fora (o caso 'Interessados' que motivou o escopo)", () => {
    expect(
      toolsDoSistemaEscolarNoTurno({
        orgConfigurada: true,
        agentToolIds: ["consultar_catalogo_cursos"],
      }),
    ).toEqual({ aluno: false, catalogo: true });
  });

  it("agente marcou as duas: as duas entram", () => {
    expect(
      toolsDoSistemaEscolarNoTurno({
        orgConfigurada: true,
        agentToolIds: ["consultar_aluno_sistema_escolar", "consultar_catalogo_cursos"],
      }),
    ).toEqual({ aluno: true, catalogo: true });
  });
});
