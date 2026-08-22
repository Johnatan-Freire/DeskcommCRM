import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { encryptKey } from "@/lib/crypto/aes_gcm";
import { carregarConfig, buscarAlunoPorTelefone, buscarCatalogoCursos } from "./sistema-escolar";

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
