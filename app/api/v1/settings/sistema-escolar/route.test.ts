import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/integracoes/sistema-escolar-config", () => ({
  lerConfigSegura: vi.fn(),
  salvarConfig: vi.fn(),
  removerConfig: vi.fn(),
  testarConexao: vi.fn(),
}));

import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import {
  lerConfigSegura,
  salvarConfig,
  removerConfig,
  testarConexao,
} from "@/lib/integracoes/sistema-escolar-config";
import { GET, PUT, DELETE } from "./route";

const ORG_ID = "org-1";
const USER_ID = "user-1";

const CONFIG_VAZIA = {
  configurado: false,
  base_url: null,
  api_key_last4: null,
  is_active: false,
  updated_at: null,
};

function authzOk(role: "manager" | "admin" = "admin") {
  (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    user: { id: USER_ID },
    org: { orgId: ORG_ID, role },
  });
}

function authzNegada() {
  (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    response: new Response(JSON.stringify({ error: { code: "forbidden_role" } }), { status: 403 }),
  });
}

function putReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/settings/sistema-escolar", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireSupportWrite).mockReset().mockResolvedValue(null);
  vi.mocked(lerConfigSegura).mockReset().mockResolvedValue(CONFIG_VAZIA);
  vi.mocked(salvarConfig).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(removerConfig).mockReset().mockResolvedValue(undefined);
  vi.mocked(testarConexao).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(audit).mockClear();
});

describe("GET /api/v1/settings/sistema-escolar", () => {
  it("recusa quem não é manager", async () => {
    authzNegada();
    const r = await GET();
    expect(r.status).toBe(403);
    expect(lerConfigSegura).not.toHaveBeenCalled();
  });

  it("devolve a configuração mascarada, filtrando pelo org do JWT", async () => {
    authzOk("manager");
    vi.mocked(lerConfigSegura).mockResolvedValue({
      configurado: true,
      base_url: "https://escola.example",
      api_key_last4: "ab12",
      is_active: true,
      updated_at: "2026-09-01T00:00:00.000Z",
    });

    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.api_key_last4).toBe("ab12");
    expect(JSON.stringify(body)).not.toMatch(/encrypted|_iv|_tag/);
    expect(lerConfigSegura).toHaveBeenCalledWith(expect.anything(), ORG_ID);
  });
});

describe("PUT /api/v1/settings/sistema-escolar", () => {
  it("recusa acompanhamento administrativo somente-leitura antes de checar role", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(new Response("readonly", { status: 403 }));
    const r = await PUT(putReq({ base_url: "https://escola.example", api_key: "chave-123456", is_active: true }));
    expect(r.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
    expect(salvarConfig).not.toHaveBeenCalled();
  });

  it("recusa quem não é admin", async () => {
    authzNegada();
    const r = await PUT(putReq({ base_url: "https://escola.example", api_key: "chave-123456", is_active: true }));
    expect(r.status).toBe(403);
    expect(salvarConfig).not.toHaveBeenCalled();
  });

  it("recusa body inválido com 422 sem tocar salvarConfig", async () => {
    authzOk();
    const r = await PUT(putReq({ base_url: "não é url", is_active: true }));
    expect(r.status).toBe(422);
    expect(salvarConfig).not.toHaveBeenCalled();
  });

  it("propaga chave_obrigatoria_na_criacao sem auditar nem testar conexão", async () => {
    authzOk();
    vi.mocked(salvarConfig).mockResolvedValue({ ok: false, motivo: "sem_chave_na_criacao" });

    const r = await PUT(putReq({ base_url: "https://escola.example", is_active: true }));
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.error.code).toBe("chave_obrigatoria_na_criacao");
    expect(audit).not.toHaveBeenCalled();
    expect(testarConexao).not.toHaveBeenCalled();
  });

  it("normaliza a barra final da base_url antes de salvar", async () => {
    authzOk();
    await PUT(putReq({ base_url: "https://escola.example/", api_key: "chave-123456", is_active: true }));
    expect(salvarConfig).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      USER_ID,
      expect.objectContaining({ baseUrl: "https://escola.example" }),
    );
  });

  it("testa a conexão só quando is_active=true, e audita o resultado", async () => {
    authzOk();
    vi.mocked(lerConfigSegura).mockResolvedValue({ ...CONFIG_VAZIA, configurado: true, is_active: true });
    vi.mocked(testarConexao).mockResolvedValue({ ok: false, erro: "timeout" });

    const r = await PUT(putReq({ base_url: "https://escola.example", api_key: "chave-123456", is_active: true }));
    expect(r.status).toBe(200);
    expect(testarConexao).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sistema_escolar.config_salva",
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        metadata: expect.objectContaining({ teste_de_conexao_ok: false }),
      }),
    );
    const body = await r.json();
    expect(body.data.teste_de_conexao).toEqual({ ok: false, erro: "timeout" });
  });

  it("não testa a conexão quando is_active=false", async () => {
    authzOk();
    vi.mocked(lerConfigSegura).mockResolvedValue({ ...CONFIG_VAZIA, configurado: true, is_active: false });

    const r = await PUT(putReq({ base_url: "https://escola.example", api_key: "chave-123456", is_active: false }));
    expect(r.status).toBe(200);
    expect(testarConexao).not.toHaveBeenCalled();
    const body = await r.json();
    expect(body.data.teste_de_conexao).toEqual({ ok: true });
  });
});

describe("DELETE /api/v1/settings/sistema-escolar", () => {
  it("recusa acompanhamento administrativo somente-leitura antes de checar role", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(new Response("readonly", { status: 403 }));
    const r = await DELETE();
    expect(r.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
    expect(removerConfig).not.toHaveBeenCalled();
  });

  it("recusa quem não é admin", async () => {
    authzNegada();
    const r = await DELETE();
    expect(r.status).toBe(403);
    expect(removerConfig).not.toHaveBeenCalled();
  });

  it("remove e audita, filtrando pelo org do JWT", async () => {
    authzOk();
    const r = await DELETE();
    expect(r.status).toBe(200);
    expect(removerConfig).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sistema_escolar.config_removida", organizationId: ORG_ID }),
    );
  });
});
