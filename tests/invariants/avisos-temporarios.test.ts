import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * Migration 0658 — AVISOS TEMPORÁRIOS. O prazo é régua do BANCO:
 * `fn_avisos_vigentes` só devolve aviso publicado, dentro do período, do público
 * e do agente certos. E o acesso: membro lê, manager+ escreve, ninguém apaga pela
 * REST, histórico append-only gravado por gatilho.
 */

const AGENTE_X = randomUUID();
const AGENTE_Y = randomUUID();

function inserirAviso(campos: {
  titulo: string;
  status?: string;
  publico?: string;
  inicio: string;
  fim: string;
  agentes?: string[];
  prioridade?: number;
}): string {
  const id = randomUUID();
  const agentes = campos.agentes && campos.agentes.length > 0 ? `array['${campos.agentes.join("','")}']::uuid[]` : "'{}'::uuid[]";
  sql(`
    insert into public.avisos_temporarios
      (id, organization_id, titulo, descricao, inicio_em, fim_em, status, publico, agente_ids, prioridade)
    values ('${id}', '${GOV_ORG}', '${campos.titulo}', 'descricao de ${campos.titulo}',
            ${campos.inicio}, ${campos.fim}, '${campos.status ?? "publicado"}', '${campos.publico ?? "todos"}',
            ${agentes}, ${campos.prioridade ?? 0});
  `);
  return id;
}

function vigentes(publico: string, agente: string | null): string[] {
  const out = sql(
    `select titulo from public.fn_avisos_vigentes('${GOV_ORG}', '${publico}', ${agente === null ? "null" : `'${agente}'`});`,
  );
  return out === "" ? [] : out.split("\n");
}

beforeAll(() => {
  seedGov();
  sql(`delete from public.avisos_temporarios where organization_id = '${GOV_ORG}';`);
  inserirAviso({ titulo: "vigente-todos", inicio: "now() - interval '1 day'", fim: "now() + interval '1 day'", prioridade: 10 });
  inserirAviso({ titulo: "vigente-leads", publico: "leads", inicio: "now() - interval '1 hour'", fim: "now() + interval '1 hour'" });
  inserirAviso({ titulo: "vigente-alunos", publico: "alunos", inicio: "now() - interval '1 hour'", fim: "now() + interval '1 hour'" });
  inserirAviso({ titulo: "agendado", inicio: "now() + interval '1 day'", fim: "now() + interval '2 days'" });
  inserirAviso({ titulo: "vencido", inicio: "now() - interval '8 days'", fim: "now() - interval '1 day'" });
  inserirAviso({ titulo: "rascunho", status: "rascunho", inicio: "now() - interval '1 day'", fim: "now() + interval '1 day'" });
  inserirAviso({ titulo: "arquivado", status: "arquivado", inicio: "now() - interval '1 day'", fim: "now() + interval '1 day'" });
  inserirAviso({ titulo: "so-agente-x", agentes: [AGENTE_X], inicio: "now() - interval '1 day'", fim: "now() + interval '1 day'" });
});

describe("0658 · fn_avisos_vigentes — o prazo é do banco", () => {
  it("leads: só publicado, dentro do período, do público certo; prioridade primeiro", () => {
    expect(vigentes("leads", null)).toEqual(["vigente-todos", "vigente-leads"]);
  });

  it("alunos não veem o aviso de leads (e vice-versa)", () => {
    expect(vigentes("alunos", null)).toEqual(["vigente-todos", "vigente-alunos"]);
  });

  it("⭐ vencido, agendado, rascunho e arquivado nunca chegam ao turno", () => {
    const todos = [...vigentes("leads", AGENTE_X), ...vigentes("alunos", AGENTE_X)];
    for (const fora of ["vencido", "agendado", "rascunho", "arquivado"]) expect(todos).not.toContain(fora);
  });

  it("aviso restrito a um agente: só ele recebe; turno sem agente resolvido não recebe", () => {
    expect(vigentes("leads", AGENTE_X)).toContain("so-agente-x");
    expect(vigentes("leads", AGENTE_Y)).not.toContain("so-agente-x");
    expect(vigentes("leads", null)).not.toContain("so-agente-x");
  });

  it("o período exige fim depois do início (CHECK)", () => {
    expect(() =>
      inserirAviso({ titulo: "invertido", inicio: "now()", fim: "now() - interval '1 hour'" }),
    ).toThrow(/avisos_temporarios_periodo/);
  });

  it("a função não é chamável por anon/authenticated (só o servidor)", () => {
    const out = sql(`
      select string_agg(r || '=' || has_function_privilege(r, 'public.fn_avisos_vigentes(uuid, text, uuid)', 'EXECUTE')::text, ',')
        from unnest(array['anon','authenticated','service_role']) r;`);
    expect(lastLine(out)).toBe("anon=false,authenticated=false,service_role=true");
  });
});

describe("0658 · acesso", () => {
  it("membro (viewer) lê os avisos da própria organização", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.avisos_temporarios where organization_id = '${GOV_ORG}';`)).toBeGreaterThan(0);
  });

  it("quem não é membro não lê nada", () => {
    expect(countAs(randomUUID(), `select count(*) from public.avisos_temporarios;`)).toBe(0);
  });

  it("agent não cria aviso; manager e admin criam", () => {
    const linha = (titulo: string) =>
      `insert into public.avisos_temporarios (organization_id, titulo, descricao, inicio_em, fim_em)
       values ('${GOV_ORG}', '${titulo}', 'x', now(), now() + interval '1 day')`;
    expect(writeCountAs(GOV_AGENT_A, linha("pelo-agent"))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, linha("pelo-manager"))).toBe(1);
    expect(writeCountAs(GOV_ADMIN, linha("pelo-admin"))).toBe(1);
  });

  it("ninguém apaga aviso pela REST — sai do ar por 'arquivado'", () => {
    const out = sql(`
      select string_agg(r || '=' || has_table_privilege(r, 'public.avisos_temporarios', 'DELETE')::text, ',')
        from unnest(array['anon','authenticated','service_role']) r;`);
    expect(lastLine(out)).toBe("anon=false,authenticated=false,service_role=false");
  });
});

describe("0658 · histórico append-only", () => {
  it("criar e alterar gravam uma linha cada, com o retrato", () => {
    const id = inserirAviso({ titulo: "com-historico", inicio: "now()", fim: "now() + interval '1 day'" });
    sql(`update public.avisos_temporarios set titulo = 'com-historico-2' where id = '${id}';`);
    const out = sql(`
      select string_agg(operacao || ':' || (retrato->>'titulo'), ',' order by id)
        from public.avisos_temporarios_historico where aviso_id = '${id}';`);
    expect(lastLine(out)).toBe("criado:com-historico,alterado:com-historico-2");
  });

  it("nenhum papel da REST altera ou apaga o histórico", () => {
    const out = sql(`
      select string_agg(r || '=' || (has_table_privilege(r, 'public.avisos_temporarios_historico', 'UPDATE')
                                   or has_table_privilege(r, 'public.avisos_temporarios_historico', 'DELETE')
                                   or has_table_privilege(r, 'public.avisos_temporarios_historico', 'TRUNCATE'))::text, ',')
        from unnest(array['anon','authenticated','service_role']) r;`);
    expect(lastLine(out)).toBe("anon=false,authenticated=false,service_role=false");
  });
});
