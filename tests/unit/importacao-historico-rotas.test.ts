/**
 * As rotas da importação do histórico: quem pode, de qual organização, e o que
 * acontece quando o pedido se repete.
 *
 * A organização vem SEMPRE da sessão do admin (requireRole) — nunca do corpo —,
 * e toda escrita com o client de service role filtra por ela.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: vi.fn(async () => false) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const { POST } = await import("@/app/api/v1/channel-sessions/[id]/history-imports/route");
const { DELETE } = await import("@/app/api/v1/channel-sessions/[id]/history-imports/[importId]/route");

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";
const CANAL = "33333333-3333-4333-8333-333333333333";
const IMPORT = "44444444-4444-4444-8444-444444444444";
const CHAVE = "55555555-5555-4555-8555-555555555555";

function sessao(role: Role = "admin") {
  const user: AuthUser = {
    id: USER,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Org", role }],
  };
  vi.mocked(requireRole).mockImplementation(async (min: Role) =>
    ROLE_RANK[role] >= ROLE_RANK[min]
      ? { ok: true, user, org: { orgId: ORG, name: "Org", role } }
      : { ok: false, response: fail("forbidden_role", `Requer role >= ${min}.`, 403, {}) },
  );
}

interface Consulta {
  tabela: string;
  op: "select" | "insert" | "update";
  filtros: [string, string, unknown][];
  payload?: unknown;
}

/** Admin falso: registra cada consulta; `responder` decide o resultado. */
function adminFalso(responder: (c: Consulta) => { data: unknown; error: unknown }) {
  const consultas: Consulta[] = [];
  const admin = {
    from(tabela: string) {
      const c: Consulta = { tabela, op: "select", filtros: [] };
      consultas.push(c);
      const b: Record<string, unknown> = {};
      const encadear = (nome: string) => (coluna: string, valor: unknown) => {
        c.filtros.push([nome, coluna, valor]);
        return b;
      };
      Object.assign(b, {
        select: () => b,
        insert: (p: unknown) => ((c.op = "insert"), (c.payload = p), b),
        update: (p: unknown) => ((c.op = "update"), (c.payload = p), b),
        eq: encadear("eq"),
        in: encadear("in"),
        order: () => b,
        limit: () => b,
        maybeSingle: async () => responder(c),
      });
      return b;
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(admin as never);
  return consultas;
}

const pedido = (corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  new NextRequest(`http://x/api/v1/channel-sessions/${CANAL}/history-imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: JSON.stringify(corpo),
  });
const params = { params: Promise.resolve({ id: CANAL }) };

beforeEach(() => {
  vi.mocked(audit).mockClear();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  sessao("admin");
});

describe("POST — pedir a importação", () => {
  it("agente não pede (403) e nada é escrito", async () => {
    sessao("agent");
    const consultas = adminFalso(() => ({ data: null, error: null }));
    const r = await POST(pedido({ janela_dias: 30 }), params);
    expect(r.status).toBe(403);
    expect(consultas).toHaveLength(0);
  });

  it("acompanhamento de suporte só-leitura é recusado antes do efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValueOnce(fail("support_readonly", "x", 403, {}));
    const consultas = adminFalso(() => ({ data: null, error: null }));
    const r = await POST(pedido({}), params);
    expect(r.status).toBe(403);
    expect(consultas).toHaveLength(0);
  });

  it("cria o recibo com a organização DA SESSÃO — um organization_id no corpo é ignorado", async () => {
    const consultas = adminFalso((c) => {
      if (c.tabela === "channel_sessions") {
        return { data: { provider: "waha", first_connected_at: "2026-09-21T19:41:34Z" }, error: null };
      }
      if (c.op === "insert") return { data: { id: IMPORT, status: "pendente" }, error: null };
      return { data: null, error: null };
    });
    const r = await POST(pedido({ janela_dias: 30, organization_id: OUTRA_ORG }), params);
    expect(r.status).toBe(200);
    const sessaoLida = consultas.find((c) => c.tabela === "channel_sessions")!;
    expect(sessaoLida.filtros).toContainEqual(["eq", "organization_id", ORG]);
    const insercao = consultas.find((c) => c.op === "insert")!.payload as Record<string, unknown>;
    expect(insercao.organization_id).toBe(ORG);
    expect(insercao.status).toBe("pendente");
    // Janela: 30 dias para trás a partir da primeira conexão, terminando nela.
    expect(insercao.janela_fim).toBe("2026-09-21T19:41:34.000Z");
    expect(insercao.janela_inicio).toBe("2026-08-22T19:41:34.000Z");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(expect.objectContaining({ action: "channel.history_import_requested", organizationId: ORG }));
  });

  it("número de outra organização (ou inexistente) é 404", async () => {
    adminFalso(() => ({ data: null, error: null }));
    expect((await POST(pedido({}), params)).status).toBe(404);
  });

  it("número que nunca conectou é 409 — não há histórico a separar do ao vivo", async () => {
    adminFalso((c) =>
      c.tabela === "channel_sessions" ? { data: { provider: "waha", first_connected_at: null }, error: null } : { data: null, error: null },
    );
    const r = await POST(pedido({}), params);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("sessao_sem_primeira_conexao");
  });

  it("janela fora de 1–730 é 422", async () => {
    adminFalso(() => ({ data: null, error: null }));
    expect((await POST(pedido({ janela_dias: 0 }), params)).status).toBe(422);
    expect((await POST(pedido({ janela_dias: 731 }), params)).status).toBe(422);
  });

  it("a mesma Idempotency-Key devolve o MESMO recibo, sem criar outro", async () => {
    const consultas = adminFalso((c) =>
      c.filtros.some(([, col]) => col === "idempotency_key") ? { data: { id: IMPORT, status: "pendente" }, error: null } : { data: null, error: null },
    );
    const r = await POST(pedido({}, { "Idempotency-Key": CHAVE }), params);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { id: string } }).data.id).toBe(IMPORT);
    expect(consultas.some((c) => c.op === "insert")).toBe(false);
  });

  it("com outra importação viva no número, 409 com a viva", async () => {
    adminFalso((c) => {
      if (c.tabela === "channel_sessions") return { data: { provider: "waha", first_connected_at: "2026-09-21T19:41:34Z" }, error: null };
      if (c.op === "insert") return { data: null, error: { code: "23505", message: "dup" } };
      return { data: { id: IMPORT, status: "em_andamento" }, error: null };
    });
    const r = await POST(pedido({}), params);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("importacao_ja_em_andamento");
  });
});

describe("DELETE — cancelar", () => {
  const del = () =>
    DELETE(new NextRequest(`http://x/api/v1/channel-sessions/${CANAL}/history-imports/${IMPORT}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: CANAL, importId: IMPORT }),
    });

  it("cancela só a viva, da organização da sessão e do número da URL", async () => {
    const consultas = adminFalso(() => ({ data: { id: IMPORT, status: "cancelada" }, error: null }));
    const r = await del();
    expect(r.status).toBe(200);
    const upd = consultas.find((c) => c.op === "update")!;
    expect(upd.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", ORG],
        ["eq", "channel_session_id", CANAL],
        ["eq", "id", IMPORT],
        ["in", "status", ["pendente", "em_andamento"]],
      ]),
    );
    expect((upd.payload as { status: string }).status).toBe("cancelada");
  });

  it("agente não cancela", async () => {
    sessao("agent");
    const consultas = adminFalso(() => ({ data: null, error: null }));
    expect((await del()).status).toBe(403);
    expect(consultas).toHaveLength(0);
  });
});
