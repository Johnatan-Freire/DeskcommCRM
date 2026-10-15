import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_VIEWER, countAs, seedGov, sql, writeCountAs } from "./gov-helpers";

/**
 * Migration 0660 — feriados do atendimento: membro lê, manager+ cadastra e
 * remove, um feriado por dia por organização.
 */
beforeAll(() => {
  seedGov();
  sql(`delete from public.feriados_de_atendimento where organization_id = '${GOV_ORG}';`);
});

describe("0660 · feriados do atendimento", () => {
  it("manager cadastra; agent não", () => {
    const linha = (data: string) =>
      `insert into public.feriados_de_atendimento (organization_id, data, descricao) values ('${GOV_ORG}', '${data}', 'Finados')`;
    expect(writeCountAs(GOV_AGENT_A, linha("2026-11-02"))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, linha("2026-11-02"))).toBe(1);
  });

  it("um feriado por dia por organização", () => {
    expect(() =>
      sql(`insert into public.feriados_de_atendimento (organization_id, data, descricao) values ('${GOV_ORG}', '2026-11-02', 'de novo');`),
    ).toThrow(/feriados_de_atendimento_um_por_dia/);
  });

  it("membro lê; quem não é membro não lê", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.feriados_de_atendimento where organization_id = '${GOV_ORG}';`)).toBe(1);
    expect(countAs(randomUUID(), `select count(*) from public.feriados_de_atendimento;`)).toBe(0);
  });

  it("agent não remove; manager remove", () => {
    expect(writeCountAs(GOV_AGENT_A, `delete from public.feriados_de_atendimento where organization_id = '${GOV_ORG}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.feriados_de_atendimento where organization_id = '${GOV_ORG}'`)).toBe(1);
  });
});
