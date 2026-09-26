/**
 * ATENDIMENTO AO ALUNO — a parte determinística da matriz (`tests/fixtures/atendimento-ao-aluno.ts`).
 *
 * O que se prova aqui não depende do modelo: o que a consulta ao sistema escolar devolve
 * (e o que ela NÃO devolve), a desambiguação sem vazamento, o conjunto de ferramentas do
 * agente, a passagem por pedido explícito e o pacote público (prompt genérico).
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { matchesHandoffKeyword } from "@/lib/agent-engine/agent/agent-config";
import { detectHumanHandoffRequest } from "@/lib/agent-engine/agent/human-handoff";
import { toolsDoSistemaEscolarNoTurno } from "@/lib/agent-engine/agent/sistema-escolar-gate";
import { buscarAlunoPorTelefone, selecionarAluno } from "@/lib/integracoes/sistema-escolar";
import { SISTEMA_ESCOLAR_TOOL_IDS } from "@/lib/integracoes/sistema-escolar-tools";
import {
  API_ANTIGA_POR_SUFIXO,
  API_DOIS_ALUNOS,
  API_NAO_ENCONTRADO,
  API_UM_ALUNO,
  MATRIZ_ATENDIMENTO_AO_ALUNO,
  PALAVRAS_DE_PASSAGEM_DO_ALUNO,
  PROMPT_FIXTURES,
} from "../fixtures/atendimento-ao-aluno";

const CONFIG = { baseUrl: "https://escola.invalid", apiKey: "chave-de-teste" };

function apiResponde(corpo: unknown) {
  const fetchFalso = vi.fn(async () => new Response(JSON.stringify(corpo), { status: 200 }));
  vi.stubGlobal("fetch", fetchFalso);
  return fetchFalso;
}
afterEach(() => vi.unstubAllGlobals());

async function consultar(corpo: unknown, nome?: string) {
  apiResponde(corpo);
  return selecionarAluno(await buscarAlunoPorTelefone(CONFIG, "5561999990000"), nome);
}

describe("identificação pelo telefone", () => {
  it("T01 — um aluno no telefone é identificado, sem o id interno", async () => {
    const r = await consultar(API_UM_ALUNO);
    expect(r.status).toBe("encontrado");
    if (r.status !== "encontrado") return;
    expect(r.aluno.nome).toBe("Joana Ficticia Souza");
    expect(JSON.stringify(r.aluno)).not.toContain('"id"');
  });

  it("T02 — dois alunos: ambíguo, só a quantidade (nada para 'adivinhar')", async () => {
    const r = await consultar(API_DOIS_ALUNOS);
    expect(r).toEqual({ status: "ambiguo", quantidade: 2 });
  });

  it("T03 — o nome completo seleciona UM, e nada do outro aluno vaza", async () => {
    const r = await consultar(API_DOIS_ALUNOS, "ana ficticia lima");
    expect(r.status).toBe("encontrado");
    const serializado = JSON.stringify(r);
    expect(serializado).toContain("Ana Ficticia Lima");
    expect(serializado).not.toContain("Pedro");
    expect(serializado).not.toContain("PROG-T1");
  });

  it("T03b — nome parecido não seleciona ninguém (sem aproximação)", async () => {
    expect((await consultar(API_DOIS_ALUNOS, "Ana Lima")).status).toBe("nome_nao_encontrado");
  });

  it("⭐ regressão DDD: API antiga devolve aluno de outro DDD pelo sufixo → nada sai", async () => {
    const r = await consultar(API_ANTIGA_POR_SUFIXO);
    expect(r).toEqual({ status: "correspondencia_nao_confirmada" });
    expect(JSON.stringify(r)).not.toContain("Aluno De Outro Ddd");
  });

  it("o campo de contato que casou não chega ao modelo", async () => {
    const r = await consultar(API_UM_ALUNO);
    expect(JSON.stringify(r)).not.toContain("matched_contact_field");
  });

  it("T04 — telefone sem cadastro: não encontrado", async () => {
    expect(await consultar(API_NAO_ENCONTRADO)).toEqual({ status: "nao_encontrado" });
  });

  it("a consulta vai pelo header, nunca com a chave na URL", async () => {
    const f = apiResponde(API_NAO_ENCONTRADO);
    await buscarAlunoPorTelefone(CONFIG, "5561999990000");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("chave-de-teste");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("chave-de-teste");
  });
});

describe("o que a consulta traz (e o que não traz)", () => {
  async function joana() {
    const r = await consultar(API_UM_ALUNO);
    if (r.status !== "encontrado") throw new Error("fixture quebrada");
    return r.aluno;
  }

  it("T05 — a nota real do módulo chega", async () => {
    expect((await joana()).matriculas[0]!.notas).toContainEqual({ modulo: "Windows", nota: "8.5", status: "aprovado" });
  });

  it("T06 — módulo sem nota fica nulo: não há o que inventar", async () => {
    expect((await joana()).matriculas[0]!.notas.find((n) => n.modulo === "Word")!.nota).toBeNull();
  });

  it("T07 — frequência em contagem real (faltas/presenças)", async () => {
    expect((await joana()).matriculas[0]!.frequencia).toEqual({ total_registros: 20, faltas: 3, presencas: 17 });
  });

  it("T08 — horário REGULAR da turma", async () => {
    expect((await joana()).matriculas[0]!.horarios[0]).toEqual({ dia_semana: "segunda", inicio: "19:00", fim: "21:00" });
  });

  it("T09 — não existe calendário, reposição nem data de avaliação no contrato (lacuna)", async () => {
    const chaves = JSON.stringify(await joana());
    for (const ausente of ["calendario", "feriado", "reposicao", "segunda_chamada", "data_avaliacao", "responsavel"]) {
      expect(chaves).not.toContain(ausente);
    }
  });

  it("T11 — situação financeira é só um rótulo, sem valor nem vencimento", async () => {
    const a = await joana();
    expect(a.situacao_financeira).toBe("Adimplente");
    expect(JSON.stringify(a)).not.toMatch(/valor|vencimento|boleto|pix/i);
  });

  it("T18 — nada no retorno diz se o telefone é do aluno ou do responsável", async () => {
    expect(Object.keys(await joana()).sort()).toEqual(["matriculas", "nome", "situacao_financeira"]);
  });
});

describe("ferramentas do agente (menor privilégio)", () => {
  it("marcando só a consulta de aluno, o catálogo comercial fica fora do turno", () => {
    expect(SISTEMA_ESCOLAR_TOOL_IDS).toContain("consultar_aluno_sistema_escolar");
    expect(
      toolsDoSistemaEscolarNoTurno({ orgConfigurada: true, agentToolIds: ["consultar_aluno_sistema_escolar"] }),
    ).toEqual({ aluno: true, catalogo: false });
  });
});

describe("passagem para uma pessoa", () => {
  it("T24 — pedido explícito é detectado sem modelo (regra central + palavras do agente)", () => {
    const pede = (frase: string) =>
      detectHumanHandoffRequest(frase) || matchesHandoffKeyword(frase, PALAVRAS_DE_PASSAGEM_DO_ALUNO);
    for (const frase of [
      "quero falar com um atendente",
      "me passa pra um humano",
      "quero falar com alguém",
      "quero falar com alguem",
      "Preciso falar com a secretaria",
      "quero falar com a coordenação",
    ]) {
      expect(pede(frase), frase).toBe(true);
    }
    for (const frase of ["qual minha nota?", "a secretaria abre que horas?", "tem aula hoje?"]) {
      expect(pede(frase), frase).toBe(false);
    }
  });

  it("a regra central sozinha NÃO pega 'falar com alguém' — por isso as palavras do agente", () => {
    expect(detectHumanHandoffRequest("quero falar com alguém")).toBe(false);
  });
});

describe("pacote público (prompt genérico)", () => {
  const REF = ".agents/skills/deskcomm-cliente-novo/references/atendimento-ao-aluno.md";
  const ref = readFileSync(REF, "utf8");
  // Espaços normalizados: o texto quebra linha no meio das frases.
  const prompt = ref.split("```markdown")[1]!.split("```")[0]!.replace(/\s+/g, " ");

  it("é genérico: sem nome de cliente, sem placeholder que o motor não substitui", () => {
    expect(ref).not.toMatch(/capital/i);
    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("{nome da escola}");
  });

  it("não cita nome de ferramenta nem vocabulário interno (o portão veta)", () => {
    for (const interno of ["consultar_aluno", "request_human_handoff", "handoff", " lead", "tool", "sistema_escolar"]) {
      expect(prompt.toLowerCase(), interno).not.toContain(interno);
    }
  });

  it("lista as palavras de passagem do agente, as mesmas da fixture", () => {
    for (const p of PALAVRAS_DE_PASSAGEM_DO_ALUNO) expect(ref, p).toContain(p);
  });

  it("carrega as regras que não se negociam", () => {
    for (const regra of [
      "Se o sistema não informou, você não sabe",
      "Encontrei mais de um aluno relacionado a este número",
      "Não liste nomes",
      "Não afirme nenhum dos dois",
      "não tenho confirmação de alterações",
      "Não informe valores",
      "Passe de fato",
      "Você não vende cursos",
      "não peça o nome de novo",
    ]) {
      expect(prompt, regra).toContain(regra);
    }
  });
});

describe("integridade da matriz", () => {
  it("T01–T25, todos presentes e na ordem", () => {
    expect(MATRIZ_ATENDIMENTO_AO_ALUNO.map((c) => c.id)).toEqual(
      Array.from({ length: 25 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("PASS aponta um arquivo que existe; SKIPPED diz por quê", () => {
    for (const c of MATRIZ_ATENDIMENTO_AO_ALUNO) {
      if (c.resultado === "PASS") {
        const arquivos = c.evidencia!.split(";").map((e) => e.trim().split(" > ")[0]!);
        for (const a of arquivos) expect(existsSync(a), `${c.id}: ${a}`).toBe(true);
      } else {
        expect(c.justificativa, c.id).toBeTruthy();
      }
    }
  });

  it("o agente nunca tem ferramenta comercial disponível", () => {
    for (const c of MATRIZ_ATENDIMENTO_AO_ALUNO) {
      expect(c.toolsDisponiveis).not.toContain("consultar_catalogo_cursos");
    }
  });

  it("fixtures de prompt: 10 perfis, a de múltiplos filhos proíbe nomear os filhos", () => {
    expect(PROMPT_FIXTURES).toHaveLength(10);
    const multi = PROMPT_FIXTURES.find((f) => f.perfil === "múltiplos filhos")!;
    expect(multi.proibido).toEqual(expect.arrayContaining(["Pedro", "Ana"]));
  });
});
