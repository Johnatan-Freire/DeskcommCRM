import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { encryptKey, decryptKey, byteaToBuffer } from "@/lib/crypto/aes_gcm";

vi.mock("@/lib/env", () => ({ env: { AI_CRED_AES_KEY: Buffer.alloc(32, 7).toString("base64") } }));

const chamar = vi.fn();
vi.mock("./sistema-escolar", async () => {
  const actual = await vi.importActual<typeof import("./sistema-escolar")>("./sistema-escolar");
  return { ...actual, chamar: (...a: unknown[]) => chamar(...a) };
});

import {
  lerConfigSegura,
  salvarConfig,
  removerConfig,
  testarConexao,
} from "./sistema-escolar-config";

const ORG_ID = "org-1";
const USER_ID = "user-1";

interface FakeState {
  row: Record<string, unknown> | null;
  upsertCalls: Array<{ payload: Record<string, unknown>; opts: unknown }>;
  upsertError?: string;
  deleteError?: string;
  deleteEq: Array<[string, unknown]>;
}

function fakeAdmin(state: FakeState): SupabaseClient {
  const admin = {
    from(_table: string) {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, val: unknown) => {
        state.deleteEq.push([col, val]);
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: state.row, error: null });
      b.upsert = (payload: Record<string, unknown>, opts: unknown) => {
        state.upsertCalls.push({ payload, opts });
        return Promise.resolve({ error: state.upsertError ? { message: state.upsertError } : null });
      };
      b.delete = () => b;
      b.then = (resolve: (v: unknown) => void) =>
        resolve({ error: state.deleteError ? { message: state.deleteError } : null });
      return b;
    },
  };
  return admin as unknown as SupabaseClient;
}

function novoEstado(row: Record<string, unknown> | null = null): FakeState {
  return { row, upsertCalls: [], deleteEq: [] };
}

afterEach(() => {
  vi.restoreAllMocks();
  chamar.mockReset();
});

describe("lerConfigSegura", () => {
  it("sem linha: configurado=false e nenhum campo cifrado no retorno", async () => {
    const out = await lerConfigSegura(fakeAdmin(novoEstado(null)), ORG_ID);
    expect(out).toEqual({
      configurado: false,
      base_url: null,
      api_key_last4: null,
      is_active: false,
      updated_at: null,
    });
  });

  it("com linha: devolve só o que a tela pode mostrar", async () => {
    const out = await lerConfigSegura(
      fakeAdmin(
        novoEstado({
          base_url: "https://escola.example",
          api_key_last4: "ab12",
          is_active: true,
          updated_at: "2026-09-01T00:00:00.000Z",
        }),
      ),
      ORG_ID,
    );
    expect(out).toEqual({
      configurado: true,
      base_url: "https://escola.example",
      api_key_last4: "ab12",
      is_active: true,
      updated_at: "2026-09-01T00:00:00.000Z",
    });
    // nunca api_key_encrypted/iv/tag no objeto devolvido à tela
    expect(JSON.stringify(out)).not.toMatch(/encrypted|_iv|_tag/);
  });
});

describe("salvarConfig", () => {
  it("criação sem chave: recusa antes de tocar o banco", async () => {
    const estado = novoEstado(null);
    const out = await salvarConfig(fakeAdmin(estado), ORG_ID, USER_ID, {
      baseUrl: "https://escola.example",
      isActive: true,
    });
    expect(out).toEqual({ ok: false, motivo: "sem_chave_na_criacao" });
    expect(estado.upsertCalls).toHaveLength(0);
  });

  it("criação com chave: cifra, seta created_by e usa onConflict por organization_id", async () => {
    const estado = novoEstado(null);
    const out = await salvarConfig(fakeAdmin(estado), ORG_ID, USER_ID, {
      baseUrl: "https://escola.example",
      apiKey: "chave-secreta-123",
      isActive: true,
    });
    expect(out).toEqual({ ok: true });
    expect(estado.upsertCalls).toHaveLength(1);
    const { payload, opts } = estado.upsertCalls[0]!;
    expect(payload.organization_id).toBe(ORG_ID);
    expect(payload.created_by).toBe(USER_ID);
    expect(payload.api_key_last4).toBe("-123");
    expect(opts).toEqual({ onConflict: "organization_id" });

    // A chave em claro não sobrevive no payload gravado — só bytea cifrado + last4.
    expect(JSON.stringify(payload)).not.toContain("chave-secreta-123");
    const decifrada = decryptKey({
      ciphertext: byteaToBuffer(payload.api_key_encrypted),
      iv: byteaToBuffer(payload.api_key_iv),
      tag: byteaToBuffer(payload.api_key_tag),
    });
    expect(decifrada).toBe("chave-secreta-123");
  });

  it("atualização sem chave: mantém a chave existente (não grava campos cifrados nem created_by)", async () => {
    const estado = novoEstado({ organization_id: ORG_ID });
    const out = await salvarConfig(fakeAdmin(estado), ORG_ID, USER_ID, {
      baseUrl: "https://escola.example/novo",
      isActive: false,
    });
    expect(out).toEqual({ ok: true });
    const { payload } = estado.upsertCalls[0]!;
    expect(payload).toEqual({
      organization_id: ORG_ID,
      base_url: "https://escola.example/novo",
      is_active: false,
    });
    expect(payload.created_by).toBeUndefined();
    expect(payload.api_key_encrypted).toBeUndefined();
  });

  it("atualização com chave: rotaciona a chave", async () => {
    const estado = novoEstado({ organization_id: ORG_ID });
    await salvarConfig(fakeAdmin(estado), ORG_ID, USER_ID, {
      baseUrl: "https://escola.example",
      apiKey: "nova-chave-xyz",
      isActive: true,
    });
    const { payload } = estado.upsertCalls[0]!;
    expect(payload.api_key_last4).toBe("-xyz");
  });

  it("erro no upsert vira exceção", async () => {
    const estado = novoEstado(null);
    estado.upsertError = "boom";
    await expect(
      salvarConfig(fakeAdmin(estado), ORG_ID, USER_ID, {
        baseUrl: "https://escola.example",
        apiKey: "chave",
        isActive: true,
      }),
    ).rejects.toThrow(/boom/);
  });
});

describe("removerConfig", () => {
  it("propaga erro do delete", async () => {
    const estado = novoEstado(null);
    estado.deleteError = "falhou";
    await expect(removerConfig(fakeAdmin(estado), ORG_ID)).rejects.toThrow(/falhou/);
  });

  it("sem erro: resolve normalmente", async () => {
    await expect(removerConfig(fakeAdmin(novoEstado(null)), ORG_ID)).resolves.toBeUndefined();
  });
});

describe("testarConexao", () => {
  it("sem configuração: erro sem chamar a rede", async () => {
    const out = await testarConexao(fakeAdmin(novoEstado(null)), ORG_ID);
    expect(out).toEqual({ ok: false, erro: "configuração não encontrada" });
    expect(chamar).not.toHaveBeenCalled();
  });

  it("decifra no mesmo escopo e chama /api/deskcomm/cursos como ping", async () => {
    const enc = encryptKey("chave-teste-999");
    const estado = novoEstado({
      base_url: "https://escola.example",
      api_key_encrypted: enc.ciphertext,
      api_key_iv: enc.iv,
      api_key_tag: enc.tag,
    });
    chamar.mockResolvedValue({ cursos: [], pacotes: [] });

    const out = await testarConexao(fakeAdmin(estado), ORG_ID);

    expect(out).toEqual({ ok: true });
    expect(chamar).toHaveBeenCalledTimes(1);
    const [configPassado, path] = chamar.mock.calls[0]!;
    expect(path).toBe("/api/deskcomm/cursos");
    expect(configPassado).toEqual({ baseUrl: "https://escola.example", apiKey: "chave-teste-999" });
  });

  it("falha de rede vira {ok:false, erro} em vez de propagar", async () => {
    const enc = encryptKey("chave-teste-999");
    const estado = novoEstado({
      base_url: "https://escola.example",
      api_key_encrypted: enc.ciphertext,
      api_key_iv: enc.iv,
      api_key_tag: enc.tag,
    });
    chamar.mockRejectedValue(new Error("sistema escolar respondeu 500"));

    const out = await testarConexao(fakeAdmin(estado), ORG_ID);
    expect(out).toEqual({ ok: false, erro: "sistema escolar respondeu 500" });
  });
});
