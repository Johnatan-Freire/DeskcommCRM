import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { encryptKey } from "@/lib/crypto/aes_gcm";
import {
  carregarConfig,
  buscarAlunoPorTelefone,
  buscarCatalogoCursos,
  selecionarAluno,
  sanitizarModalidades,
  sanitizarCatalogo,
  filtrarCatalogo,
  type RespostaAlunoPorTelefone,
  type CatalogoCurso,
  type CatalogoPacote,
} from "./sistema-escolar";

vi.mock("@/lib/env", () => ({ env: { AI_CRED_AES_KEY: Buffer.alloc(32, 7).toString("base64") } }));

function dublePg(rows: unknown[]): pg.Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as pg.Pool;
}

describe("carregarConfig", () => {
  it("org sem linha configurada: null (estado normal, não erro)", async () => {
    expect(await carregarConfig(dublePg([]), "org1")).toBeNull();
  });

  it("linha com is_active=false: null (desativada pelo tenant)", async () => {
    const enc = encryptKey("chave-secreta");
    const config = await carregarConfig(
      dublePg([
        {
          base_url: "https://escola.example",
          api_key_encrypted: enc.ciphertext,
          api_key_iv: enc.iv,
          api_key_tag: enc.tag,
          is_active: false,
        },
      ]),
      "org1",
    );
    expect(config).toBeNull();
  });

  it("decifra a chave e tira a barra final da base_url", async () => {
    const enc = encryptKey("chave-secreta-123");
    const config = await carregarConfig(
      dublePg([
        {
          base_url: "https://escola.example/",
          api_key_encrypted: enc.ciphertext,
          api_key_iv: enc.iv,
          api_key_tag: enc.tag,
          is_active: true,
        },
      ]),
      "org1",
    );
    expect(config).toEqual({ baseUrl: "https://escola.example", apiKey: "chave-secreta-123" });
  });
});

describe("buscarAlunoPorTelefone / buscarCatalogoCursos", () => {
  let fetchOriginal: typeof globalThis.fetch;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  const config = { baseUrl: "https://escola.example", apiKey: "chave-123" };

  it("manda a chave no header X-Api-Key e monta a URL certa", async () => {
    let urlChamada: string | undefined;
    let headerChamado: string | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urlChamada = String(input);
      headerChamado = (init?.headers as Record<string, string>)?.["X-Api-Key"];
      return new Response(JSON.stringify({ encontrado: true, alunos: [] }), { status: 200 });
    }) as typeof fetch;

    await buscarAlunoPorTelefone(config, "5511999998888");

    expect(urlChamada).toBe("https://escola.example/api/deskcomm/aluno?telefone=5511999998888");
    expect(headerChamado).toBe("chave-123");
  });

  it("resposta não-ok vira erro (o chamador decide o que fazer)", async () => {
    globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
    await expect(buscarAlunoPorTelefone(config, "5511999998888")).rejects.toThrow(/401/);
  });

  it("rejeita resposta acadêmica fora do contrato em vez de entregar dado imprevisível ao modelo", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ encontrado: true, alunos: [{ nome: "Ana" }] }), {
        status: 200,
      })) as typeof fetch;

    await expect(buscarAlunoPorTelefone(config, "5511999998888")).rejects.toThrow();
  });

  it("buscarCatalogoCursos chama /api/deskcomm/cursos", async () => {
    let urlChamada: string | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urlChamada = String(input);
      return new Response(JSON.stringify({ cursos: [], pacotes: [] }), { status: 200 });
    }) as typeof fetch;

    const out = await buscarCatalogoCursos(config);

    expect(urlChamada).toBe("https://escola.example/api/deskcomm/cursos");
    expect(out).toEqual({ cursos: [], pacotes: [] });
  });

  it("schema tipado: curso real (payload de produção) passa no parse", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ cursos: [CURSO_INFORMATICA], pacotes: [] }), { status: 200 })) as typeof fetch;
    const out = await buscarCatalogoCursos(config);
    expect(out.cursos).toHaveLength(1);
    expect(out.cursos[0]).toMatchObject({ nome: "Informática Básica", valor_integral: "780.00" });
  });

  it("T-schema: campo obrigatório faltando (nome) → ZodError, que o catch de inbound-turn.ts já cobre", async () => {
    const { nome: _nome, ...semNome } = CURSO_INFORMATICA;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ cursos: [semNome], pacotes: [] }), { status: 200 })) as typeof fetch;
    await expect(buscarCatalogoCursos(config)).rejects.toThrow();
  });

  it("T-schema: tipo incorreto (valor_integral como number) → ZodError", async () => {
    const tipoErrado = { ...CURSO_INFORMATICA, valor_integral: 780 };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ cursos: [tipoErrado], pacotes: [] }), { status: 200 })) as typeof fetch;
    await expect(buscarCatalogoCursos(config)).rejects.toThrow();
  });
});

/** Curso real medido em produção (2026-09-22) — usado como fixture em vários testes abaixo. */
const CURSO_INFORMATICA: CatalogoCurso = {
  tipo: "curso",
  nome: "Informática Básica",
  descricao: "Prepara para uso do computador e internet com autonomia no dia a dia e no ambiente de trabalho.",
  area: null,
  modalidade: ["presencial", "ead"],
  turnos: ["matutino", "vespertino"],
  carga_horaria: "44.0",
  duracao_meses: 6,
  publico_alvo: null,
  saidas_profissionais: null,
  valor_integral: "780.00",
  valor_avista: "624.00",
  parcelas: 6,
  valor_parcela: "130.00",
  em_destaque: false,
};

const CURSO_PROGRAMACAO_INICIANTES: CatalogoCurso = {
  ...CURSO_INFORMATICA,
  nome: "Programação para iniciantes",
  valor_integral: "980.00",
};

const CURSO_PROGRAMACAO_JOGOS: CatalogoCurso = {
  ...CURSO_INFORMATICA,
  nome: "Programação - Criação de Jogos",
  valor_integral: "650.00",
};

const PACOTE_PROGRAMACAO_WEB: CatalogoPacote = {
  tipo: "pacote",
  nome: "Programação e Desenvolvimento Web",
  descricao: "Formação completa",
  area: null,
  cursos_inclusos: ["Informática Básica", "Programação para iniciantes", "Desenvolvimento Web"],
  carga_horaria: 190,
  duracao_meses: 25,
  publico_alvo: null,
  objetivo_profissional: null,
  habilidades: null,
  valor_integral: "2457.00",
  valor_avista: "1965.60",
  parcelas: 21,
  valor_parcela: "117.00",
  economia_total: "1053.00",
};

const PACOTE_SEM_PARCELAMENTO: CatalogoPacote = {
  tipo: "pacote",
  nome: "Informática Completa",
  descricao: "Operador de computador, Web Design, Design Gráfico",
  area: null,
  cursos_inclusos: ["Informática Básica", "Design Gráfico"],
  carga_horaria: null,
  duracao_meses: null,
  publico_alvo: null,
  objetivo_profissional: null,
  habilidades: null,
  valor_integral: "1400.00",
  valor_avista: null,
  parcelas: null,
  valor_parcela: null,
  economia_total: null,
};

describe("sanitizarModalidades — item 0.2: híbrido/hibrido NÃO é modalidade comercial atual (T70/T71)", () => {
  it('["presencial"] → ok, canônico', () => {
    expect(sanitizarModalidades(["presencial"], { curso: "X" })).toEqual({
      modalidade: ["presencial"],
      modalidade_status: "ok",
    });
  });

  it('["ead"] → ok', () => {
    expect(sanitizarModalidades(["ead"], { curso: "X" })).toEqual({
      modalidade: ["ead"],
      modalidade_status: "ok",
    });
  });

  it('["presencial","ead"] → ok, os dois', () => {
    expect(sanitizarModalidades(["presencial", "ead"], { curso: "X" })).toEqual({
      modalidade: ["presencial", "ead"],
      modalidade_status: "ok",
    });
  });

  it('T70: ["hibrido"] (sem acento) → modalidade=[], inconsistente — NUNCA aparece como válido', () => {
    expect(sanitizarModalidades(["hibrido"], { curso: "X" })).toEqual({
      modalidade: [],
      modalidade_status: "inconsistente",
    });
  });

  it('["híbrido"] (com acento) → mesmo tratamento: modalidade=[], inconsistente', () => {
    expect(sanitizarModalidades(["híbrido"], { curso: "X" })).toEqual({
      modalidade: [],
      modalidade_status: "inconsistente",
    });
  });

  it('T71: ["presencial","banana"] → modalidade=["presencial"], inconsistente (parcial)', () => {
    expect(sanitizarModalidades(["presencial", "banana"], { curso: "X" })).toEqual({
      modalidade: ["presencial"],
      modalidade_status: "inconsistente",
    });
  });

  it('["presencial","hibrido"] → modalidade=["presencial"], inconsistente', () => {
    expect(sanitizarModalidades(["presencial", "hibrido"], { curso: "X" })).toEqual({
      modalidade: ["presencial"],
      modalidade_status: "inconsistente",
    });
  });

  it('["banana"] → modalidade=[], inconsistente — nunca derruba a chamada (nunca lança)', () => {
    expect(() => sanitizarModalidades(["banana"], { curso: "X" })).not.toThrow();
    expect(sanitizarModalidades(["banana"], { curso: "X" })).toEqual({
      modalidade: [],
      modalidade_status: "inconsistente",
    });
  });

  it("array vazio (curso sem modalidade cadastrada) → inconsistente, nunca 'ok' por omissão", () => {
    expect(sanitizarModalidades([], { curso: "X" }).modalidade_status).toBe("inconsistente");
  });
});

describe("sanitizarCatalogo — aplica a sanitização a todo o catálogo, raw nunca chega ao modelo", () => {
  it("curso com modalidade legada: o objeto devolvido NUNCA contém 'hibrido' em lugar nenhum", () => {
    const curso = { ...CURSO_INFORMATICA, modalidade: ["hibrido"] };
    const out = sanitizarCatalogo({ cursos: [curso], pacotes: [] });
    const serializado = JSON.stringify(out.cursos[0]);
    expect(serializado).not.toContain("hibrido");
    expect(out.cursos[0]).toMatchObject({ modalidade: [], modalidade_status: "inconsistente" });
  });

  it("pacotes passam intocados (não têm campo modalidade no contrato real)", () => {
    const out = sanitizarCatalogo({ cursos: [], pacotes: [PACOTE_PROGRAMACAO_WEB] });
    expect(out.pacotes).toEqual([PACOTE_PROGRAMACAO_WEB]);
  });
});

describe("filtrarCatalogo — busca determinística, sem escolha arbitrária (T53/T54)", () => {
  const catalogo = sanitizarCatalogo({
    cursos: [CURSO_INFORMATICA, CURSO_PROGRAMACAO_INICIANTES, CURSO_PROGRAMACAO_JOGOS],
    pacotes: [PACOTE_PROGRAMACAO_WEB, PACOTE_SEM_PARCELAMENTO],
  });

  it("sem query: devolve tudo, ambiguous=false", () => {
    const r = filtrarCatalogo(catalogo, {});
    expect(r.match_count).toBe(5);
    expect(r.ambiguous).toBe(false);
  });

  it('T53: "Informática Básica" (nome exato) → 1 match, ambiguous=false', () => {
    const r = filtrarCatalogo(catalogo, { query: "Informática Básica" });
    expect(r.match_count).toBe(1);
    expect(r.ambiguous).toBe(false);
    expect(r.cursos[0]?.nome).toBe("Informática Básica");
  });

  it('"informatica basica" sem acento/case → ainda bate (normalização só pra comparação)', () => {
    const r = filtrarCatalogo(catalogo, { query: "informatica basica" });
    expect(r.match_count).toBe(1);
    // nome original preservado no retorno, mesmo a busca sendo normalizada
    expect(r.cursos[0]?.nome).toBe("Informática Básica");
  });

  it('T54: "programação" → múltiplos candidatos (2 cursos + 1 pacote), ambiguous=true, NUNCA escolhe sozinho', () => {
    const r = filtrarCatalogo(catalogo, { query: "programação" });
    expect(r.match_count).toBe(3);
    expect(r.ambiguous).toBe(true);
    expect(r.cursos.map((c) => c.nome).sort()).toEqual(
      ["Programação - Criação de Jogos", "Programação para iniciantes"].sort(),
    );
    expect(r.pacotes.map((p) => p.nome)).toEqual(["Programação e Desenvolvimento Web"]);
  });

  it('query sem nenhum match → match_count=0, listas vazias, NUNCA inventa', () => {
    const r = filtrarCatalogo(catalogo, { query: "curso de astrologia" });
    expect(r).toEqual({ cursos: [], pacotes: [], match_count: 0, ambiguous: false });
  });

  it('tipo="curso" restringe a busca — pacote que bateria fica de fora', () => {
    const r = filtrarCatalogo(catalogo, { query: "programação", tipo: "curso" });
    expect(r.match_count).toBe(2);
    expect(r.pacotes).toEqual([]);
  });

  it('tipo="pacote" restringe — cursos que bateriam ficam de fora', () => {
    const r = filtrarCatalogo(catalogo, { query: "programação", tipo: "pacote" });
    expect(r.match_count).toBe(1);
    expect(r.cursos).toEqual([]);
  });
});

function aluno(nome: string, id: number): RespostaAlunoPorTelefone["alunos"][number] {
  return {
    id,
    nome,
    situacao_financeira: "Em dia",
    matriculas: [
      {
        status: "ativo",
        curso_ou_pacote: "Desenvolvimento Web",
        tipo: "curso",
        turma: "Turma Noite",
        modalidade: "online",
        horarios: [{ dia_semana: "Segunda", inicio: "19:00:00", fim: "22:00:00" }],
        link_aula: "https://meet.example/aula",
        data_matricula: "2026-01-10",
        notas: [{ modulo: "HTML/CSS", nota: "8.5", status: "aprovado" }],
        frequencia: { total_registros: 10, faltas: 2, presencas: 8 },
      },
    ],
  };
}

describe("selecionarAluno", () => {
  it("entrega os dados que respondem curso, nota, faltas e situação financeira", () => {
    const resultado = selecionarAluno({
      encontrado: true,
      ambiguo: false,
      alunos: [aluno("Ana Souza", 42)],
    });

    expect(resultado).toEqual({
      status: "encontrado",
      aluno: expect.objectContaining({
        nome: "Ana Souza",
        situacao_financeira: "Em dia",
        matriculas: [
          expect.objectContaining({
            curso_ou_pacote: "Desenvolvimento Web",
            notas: [{ modulo: "HTML/CSS", nota: "8.5", status: "aprovado" }],
            frequencia: { total_registros: 10, faltas: 2, presencas: 8 },
          }),
        ],
      }),
    });
    expect(JSON.stringify(resultado)).not.toContain('"id":42');
  });

  it("telefone compartilhado não entrega os cadastros antes de pedir o nome completo", () => {
    const resultado = selecionarAluno({
      encontrado: true,
      ambiguo: true,
      alunos: [aluno("Ana Souza", 1), aluno("Bruno Souza", 2)],
    });

    expect(resultado).toEqual({ status: "ambiguo", quantidade: 2 });
    expect(JSON.stringify(resultado)).not.toContain("Ana Souza");
    expect(JSON.stringify(resultado)).not.toContain("Bruno Souza");
  });

  it("desambigua pelo nome completo ignorando caixa, acento e espaços repetidos", () => {
    const resultado = selecionarAluno(
      {
        encontrado: true,
        ambiguo: true,
        alunos: [aluno("Ána  de Souza", 1), aluno("Bruno Souza", 2)],
      },
      "ana de souza",
    );

    expect(resultado).toMatchObject({ status: "encontrado", aluno: { nome: "Ána  de Souza" } });
    expect(JSON.stringify(resultado)).not.toContain("Bruno Souza");
  });

  it("nome que não corresponde não escolhe o aluno por aproximação", () => {
    const resultado = selecionarAluno(
      {
        encontrado: true,
        ambiguo: true,
        alunos: [aluno("Ana Souza", 1), aluno("Bruno Souza", 2)],
      },
      "Ana Silva",
    );

    expect(resultado).toEqual({ status: "nome_nao_encontrado" });
  });
});
