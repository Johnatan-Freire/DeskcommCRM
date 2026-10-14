/**
 * Avisos temporários (0658) — o contrato da tela/API e o bloco que entra no prompt.
 * A régua do prazo é do banco (ver tests/invariants/avisos-temporarios.test.ts);
 * aqui, o que o MODELO lê e o que a API aceita.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AVISOS_INDISPONIVEIS,
  criarAvisoSchema,
  editarAvisoSchema,
  publicoDoEscopo,
  renderAvisosVigentes,
} from "@/lib/ai/avisos-temporarios";
import { situacaoDoAviso } from "@/app/app/ai/avisos/_client";

describe("bloco do prompt", () => {
  it("sem aviso vigente o modelo recebe a regra mesmo assim: promoção fora da lista não existe", () => {
    const bloco = renderAvisosVigentes([], "America/Sao_Paulo");
    expect(bloco).toContain("nenhum aviso vigente");
    expect(bloco).toMatch(/não existe: não ofereça, não invente e não estenda prazo/);
  });

  it("cada aviso diz até quando vale, no fuso da organização", () => {
    const bloco = renderAvisosVigentes(
      [{ titulo: "Matrícula com 10% off", descricao: "10% no curso de Excel.", fim_em: "2026-10-21T02:59:00Z", cursos: ["Excel"] }],
      "America/Sao_Paulo",
    );
    expect(bloco).toContain("- Matrícula com 10% off (válido até 20/10/2026, 23:59): 10% no curso de Excel. Cursos: Excel.");
  });

  it("leitura falhou: o turno segue, mas nenhuma condição especial pode ser oferecida", () => {
    expect(AVISOS_INDISPONIVEIS).toMatch(/Não ofereça promoção, desconto, data de turma nem condição especial/);
  });

  it("escopo do agente → público: acadêmico lê 'alunos', o resto lê 'leads'", () => {
    expect(publicoDoEscopo("academico")).toBe("alunos");
    expect(publicoDoEscopo("comercial")).toBe("leads");
    expect(publicoDoEscopo(null)).toBe("leads");
  });
});

describe("contrato da API", () => {
  const base = {
    titulo: "Início da turma de Excel",
    descricao: "A turma de Excel começa dia 03/11.",
    inicio_em: "2026-10-14T12:00:00-03:00",
    fim_em: "2026-11-03T23:59:00-03:00",
  };

  it("criar: aceita o mínimo e preenche os padrões seguros (rascunho, todos, sem agente)", () => {
    const r = criarAvisoSchema.parse(base);
    expect(r).toMatchObject({ status: "rascunho", publico: "todos", agente_ids: [], cursos: [], prioridade: 0 });
    expect(r.inicio_em).toBe("2026-10-14T15:00:00.000Z");
  });

  it("criar: fim antes do início é recusado", () => {
    expect(criarAvisoSchema.safeParse({ ...base, fim_em: "2026-10-01T00:00:00Z" }).success).toBe(false);
  });

  it("criar: aviso SEM prazo é recusado (isso é a Memória da Org, não um aviso)", () => {
    const { fim_em: _fim, ...semFim } = base;
    expect(criarAvisoSchema.safeParse(semFim).success).toBe(false);
  });

  it("campos fora do contrato são recusados (organization_id nunca vem do corpo)", () => {
    expect(criarAvisoSchema.safeParse({ ...base, organization_id: "x" }).success).toBe(false);
    expect(editarAvisoSchema.safeParse({ created_by: "x" }).success).toBe(false);
  });

  it("editar: corpo vazio é recusado", () => {
    expect(editarAvisoSchema.safeParse({}).success).toBe(false);
  });
});

describe("situação mostrada na tela = a régua do banco", () => {
  const agora = new Date("2026-10-14T12:00:00Z");
  it.each([
    [{ status: "publicado", inicio_em: "2026-10-13T00:00:00Z", fim_em: "2026-10-15T00:00:00Z" }, "vigente"],
    [{ status: "publicado", inicio_em: "2026-10-15T00:00:00Z", fim_em: "2026-10-16T00:00:00Z" }, "agendado"],
    [{ status: "publicado", inicio_em: "2026-10-01T00:00:00Z", fim_em: "2026-10-14T12:00:00Z" }, "vencido"],
    [{ status: "rascunho", inicio_em: "2026-10-13T00:00:00Z", fim_em: "2026-10-15T00:00:00Z" }, "rascunho"],
    [{ status: "arquivado", inicio_em: "2026-10-13T00:00:00Z", fim_em: "2026-10-15T00:00:00Z" }, "arquivado"],
  ] as const)("%o → %s", (aviso, esperado) => {
    expect(situacaoDoAviso(aviso, agora)).toBe(esperado);
  });
});

describe("o turno lê os avisos", () => {
  const fonte = readFileSync("lib/agent-engine/agent/inbound-turn.ts", "utf8");
  it("carrega pelo escopo e pelo agente resolvidos, e fecha na falha", () => {
    expect(fonte).toContain("carregarAvisosVigentes(pool, {");
    expect(fonte).toContain("escopoDoAgente: agentConfig?.serviceScope ?? null");
    expect(fonte).toContain("blocosResidentes.push(AVISOS_INDISPONIVEIS)");
  });
});
