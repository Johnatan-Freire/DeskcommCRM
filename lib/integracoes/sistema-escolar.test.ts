import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { encryptKey } from "@/lib/crypto/aes_gcm";
import {
  carregarConfig,
  buscarAlunoPorTelefone,
  buscarCatalogoCursos,
  selecionarAluno,
  type RespostaAlunoPorTelefone,
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
