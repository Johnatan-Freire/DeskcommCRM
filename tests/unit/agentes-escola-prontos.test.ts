/**
 * OS DOIS AGENTES DA ESCOLA ESTÃO PRONTOS PARA SEREM CRIADOS — e o que eles podem
 * fazer é decidido por código, não pelo prompt.
 *
 * Os perfis (`lib/ai/agents/modelos-escola.ts`) passam pelo MESMO schema que a
 * tela usa para criar versão; as capacidades de cada um passam pelas funções que o
 * turno usa de verdade (tools ocultas, executor, palavras de passagem). No fim, o
 * mapa dos 25 casos da especificação do dono do produto (2026-09-30) aponta o
 * arquivo onde cada um é provado — e o teste reprova arquivo que não existe.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { matchesHandoffKeyword } from "@/lib/agent-engine/agent/agent-config";
import { ferramentasOcultasPeloEscopo } from "@/lib/agent-engine/agent/ferramentas-por-escopo";
import { detectHumanHandoffRequest } from "@/lib/agent-engine/agent/human-handoff";
import { verificarAutorizacaoTerminal, verificarPermissaoDeMoverFunil } from "@/lib/agent-engine/agent/lead-state";
import {
  PALAVRAS_DE_PASSAGEM_ESCOLA,
  PERFIL_ACADEMICO_ESCOLA,
  PERFIL_COMERCIAL_ESCOLA,
  PROMPT_ACADEMICO_ESCOLA,
  PROMPT_COMERCIAL_ESCOLA,
} from "@/lib/ai/agents/modelos-escola";
import { versionCreateSchema } from "@/lib/ai/agents/validation";

const UUID = "00000000-0000-4000-8000-000000000001";
/** Os campos que dependem da organização, como a criação em produção os preencherá. */
const DA_ORGANIZACAO = {
  provider: "openai",
  model: "gpt-4o-mini",
  credential_id: UUID,
  channel_session_id: UUID,
};
const escopoDe = (p: typeof PERFIL_COMERCIAL_ESCOLA) => ({
  serviceScope: p.service_scope as "comercial" | "academico",
  canUpdateLeadState: p.can_update_lead_state as boolean,
});

describe("os perfis passam pelo schema oficial de versão", () => {
  it.each([
    ["comercial", PERFIL_COMERCIAL_ESCOLA],
    ["acadêmico", PERFIL_ACADEMICO_ESCOLA],
  ])("%s: versão válida", (_nome, perfil) => {
    const r = versionCreateSchema.safeParse({ ...DA_ORGANIZACAO, ...perfil });
    expect(r.success, JSON.stringify(r.error?.flatten())).toBe(true);
  });
});

describe("comercial — Novo, Interessado, Fechando condições; move o funil, nunca ganha", () => {
  it("escopo comercial, pode mover o funil, NÃO marca ganho (o funil não tem ganho), marca perda", () => {
    expect(PERFIL_COMERCIAL_ESCOLA).toMatchObject({
      service_scope: "comercial",
      can_update_lead_state: true,
      can_mark_won: false,
      can_mark_lost: true,
    });
  });

  it("11 · pode mover dentro das transições: a tool está no turno e o executor autoriza", () => {
    expect(ferramentasOcultasPeloEscopo(escopoDe(PERFIL_COMERCIAL_ESCOLA))).toEqual([]);
    expect(verificarPermissaoDeMoverFunil(escopoDe(PERFIL_COMERCIAL_ESCOLA))).toEqual({ ok: true });
    const autorizacao = { canMarkWon: PERFIL_COMERCIAL_ESCOLA.can_mark_won!, canMarkLost: PERFIL_COMERCIAL_ESCOLA.can_mark_lost! };
    expect(verificarAutorizacaoTerminal("won", autorizacao).ok, "won recusado").toBe(false);
    expect(verificarAutorizacaoTerminal("lost", autorizacao).ok, "lost permitido").toBe(true);
  });

  it("menor privilégio: nenhuma tool do catálogo MCP; do sistema escolar, só o catálogo de cursos", () => {
    expect(PERFIL_COMERCIAL_ESCOLA.tool_ids).toEqual([]);
    expect(PERFIL_COMERCIAL_ESCOLA.sistema_escolar_tool_ids).toEqual(["consultar_catalogo_cursos"]);
    expect(PERFIL_COMERCIAL_ESCOLA.sistema_escolar_tool_ids).not.toContain("consultar_aluno_sistema_escolar");
  });
});

describe("acadêmico — só Alunos e responsáveis; nunca move o funil", () => {
  it("escopo acadêmico, sem mover funil, sem ganho, sem perda", () => {
    expect(PERFIL_ACADEMICO_ESCOLA).toMatchObject({
      service_scope: "academico",
      can_update_lead_state: false,
      can_mark_won: false,
      can_mark_lost: false,
    });
  });

  it("10 · update_lead_state some do turno E o executor recusa (duas camadas)", () => {
    const ocultas = ferramentasOcultasPeloEscopo(escopoDe(PERFIL_ACADEMICO_ESCOLA));
    expect(ocultas).toContain("update_lead_state");
    expect(ocultas, "follow-up é comercial").toContain("schedule_followup");
    // Mesmo com can_update_lead_state=true por engano, o escopo acadêmico vence nas duas camadas.
    const porEngano = { serviceScope: "academico" as const, canUpdateLeadState: true };
    expect(ferramentasOcultasPeloEscopo(porEngano)).toContain("update_lead_state");
    expect(verificarPermissaoDeMoverFunil(porEngano)).toMatchObject({ ok: false, error: { code: "funil_nao_autorizado" } });
  });

  it("menor privilégio: só a consulta do aluno; nada de catálogo, materiais comerciais ou MCP", () => {
    expect(PERFIL_ACADEMICO_ESCOLA.tool_ids).toEqual([]);
    expect(PERFIL_ACADEMICO_ESCOLA.sistema_escolar_tool_ids).toEqual(["consultar_aluno_sistema_escolar"]);
  });
});

describe("16–19 · passagem para uma pessoa, com as palavras DO PERFIL", () => {
  const pede = (perfil: typeof PERFIL_COMERCIAL_ESCOLA, frase: string) =>
    detectHumanHandoffRequest(frase) || matchesHandoffKeyword(frase, perfil.handoff_keywords ?? []);

  it.each([
    "quero falar com alguém",
    "quero falar com alguem",
    "preciso falar com a secretaria",
    "é da secretaria?",
    "quero falar com a coordenação",
    "quero falar com a coordenacao",
    "quero falar com o professor",
    "a professora pode me ligar?",
    "quero atendimento humano",
    "quero falar com atendente",
  ])("«%s» → passa para uma pessoa nos DOIS agentes", (frase) => {
    expect(pede(PERFIL_COMERCIAL_ESCOLA, frase), "comercial").toBe(true);
    expect(pede(PERFIL_ACADEMICO_ESCOLA, frase), "acadêmico").toBe(true);
  });

  it("os dois perfis carregam a lista inteira", () => {
    for (const p of [PERFIL_COMERCIAL_ESCOLA, PERFIL_ACADEMICO_ESCOLA]) {
      expect(p.handoff_keywords).toEqual([...PALAVRAS_DE_PASSAGEM_ESCOLA]);
    }
  });

  it("controle: pergunta comum não chama pessoa", () => {
    for (const frase of ["qual minha nota?", "quanto custa o curso de Excel?", "tem turma à noite?"]) {
      expect(pede(PERFIL_COMERCIAL_ESCOLA, frase), frase).toBe(false);
    }
  });
});

describe("prompts", () => {
  const GUIA = ".agents/skills/deskcomm-cliente-novo/references/atendimento-ao-aluno.md";
  const normaliza = (t: string) => t.replace(/\s+/g, " ").trim();

  it("o prompt acadêmico do módulo é o MESMO do guia — uma redação só", () => {
    const doGuia = readFileSync(GUIA, "utf8").split("```markdown")[1]!.split("```")[0]!;
    expect(normaliza(PROMPT_ACADEMICO_ESCOLA)).toBe(normaliza(doGuia));
  });

  it.each([
    ["comercial", PROMPT_COMERCIAL_ESCOLA],
    ["acadêmico", PROMPT_ACADEMICO_ESCOLA],
  ])("%s: genérico e sem vocabulário interno (o portão de saída veta)", (_n, prompt) => {
    expect(prompt).not.toMatch(/capital/i);
    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("{nome da escola}");
    for (const interno of ["update_lead_state", "consultar_", "sistema_escolar", "service_scope", "tool"]) {
      expect(prompt.toLowerCase(), interno).not.toContain(interno);
    }
  });

  it("comercial: não promete dado escolar; oferece a equipe quando perguntam nota/frequência", () => {
    expect(PROMPT_COMERCIAL_ESCOLA).toMatch(/você\s+não tem acesso a esses dados/i);
    expect(PROMPT_COMERCIAL_ESCOLA).not.toMatch(/nota é|frequência é/i);
  });

  it("13 · acadêmico: pergunta de preço de curso passa para a equipe, sem cotar", () => {
    expect(PROMPT_ACADEMICO_ESCOLA).toMatch(/outro curso, preço de curso ou nova matrícula/);
    expect(PROMPT_ACADEMICO_ESCOLA).toMatch(/Não fale de preço nem de condição/);
  });

  it("20/21 · acadêmico: desambigua pelo nome completo, não lista nomes, não infere parentesco", () => {
    expect(PROMPT_ACADEMICO_ESCOLA).toMatch(/Pode me informar o nome completo do aluno\?/);
    expect(PROMPT_ACADEMICO_ESCOLA).toMatch(/Não liste nomes/);
    expect(PROMPT_ACADEMICO_ESCOLA).toMatch(/e não "Seu filho tirou 8,5"/);
  });
});

/**
 * Onde cada um dos 25 casos é provado. Os de banco rodam contra Postgres real
 * (`pnpm test:db`); os demais no `test:unit`.
 */
const MAPA_DOS_CASOS: Array<[string, string]> = [
  ["1 Novo + comercial → elegível", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["2 Interessado + comercial → elegível", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["3 Fechando condições + comercial → elegível", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["4 Desistiu → nenhum agente", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["5 Desqualificado → nenhum agente", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["6 Equipe → nenhuma IA", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["7 Alunos → só acadêmico", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["8 comercial em Alunos → bloqueado", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["9 acadêmico em Novo → bloqueado", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["10 acadêmico sem update_lead_state (tool + executor)", "tests/unit/agentes-escola-prontos.test.ts"],
  ["11 comercial move dentro das transições", "tests/unit/agentes-escola-prontos.test.ts"],
  ["12 comercial não move Alunos (PT423)", "tests/invariants/politica-de-atendimento-por-etapa.test.ts"],
  ["13 aluno pergunta preço → fica em Alunos", "tests/unit/identidade-escolar-antes-do-agente.test.ts"],
  ["14 handoff comercial → Equipe", "tests/unit/handoff-stage-move.test.ts"],
  ["15 handoff acadêmico → card fica em Alunos", "tests/unit/politica-de-etapa-no-codigo.test.ts"],
  ["16–19 palavras de passagem", "tests/unit/agentes-escola-prontos.test.ts"],
  ["20 vários alunos → desambiguação", "tests/unit/atendimento-ao-aluno.test.ts"],
  ["21 numero_contato2 não infere responsável", "tests/unit/identidade-escolar-antes-do-agente.test.ts"],
  ["22 Sistema Escolar indisponível → sem vazamento", "tests/unit/identidade-escolar-antes-do-agente.test.ts"],
  ["23 humano assumiu → IA não responde", "tests/invariants/ia-silenciada-no-envio.test.ts"],
  ["24 escopo relido no envio", "tests/unit/identidade-escolar-antes-do-agente.test.ts"],
  ["25 um turno por contato", "tests/invariants/um-turno-por-contato.test.ts"],
];

describe("mapa dos 25 casos", () => {
  it.each(MAPA_DOS_CASOS)("%s → %s existe", (_caso, arquivo) => {
    expect(existsSync(arquivo), arquivo).toBe(true);
  });
});
