/**
 * O VIEWER VÊ NA FILA O MESMO QUE O CONTADOR DA FILA DIZ.
 *
 * ─── O defeito (medido em produção em 2026-10-02) ──────────────────────────
 *
 * A aba "Fila" depende de um fato da organização: há atendimento automático no
 * ar? Sem automático, a fila inclui as conversas `automatico` (senão nasce vazia
 * com clientes esperando — ver `comandosDaFila`). O CONTADOR responde isso no
 * servidor para qualquer papel (`/api/v1/conversations/counts` →
 * `orgTemAutomatico`). A LISTA perguntava pela rota `/api/v1/ai/automatico-ativo`,
 * que só respondia a `agent+` — e o hook nem perguntava sem `ai.automatico.view`.
 * Para o viewer a resposta ficava `undefined`, `comandosDaFila(undefined)` caía
 * em "há automático", e a lista mostrava 2 conversas sob um contador de 51.
 *
 * ─── Por que abrir para o viewer não abre nada ─────────────────────────────
 *
 * A rota devolve UM booleano, e foi criada exatamente para não expor prompt,
 * modelo nem guardrails. O PRD dá ao viewer "GET em todos os recursos do
 * tenant", e o contador já calcula o mesmo booleano para ele no servidor.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
  agentes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api/client", () => ({ apiClient: { get: mocks.get } }));
vi.mock("@/lib/supabase/browser", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase/browser")>()),
  createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }),
}));
vi.mock("@/lib/auth/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/server")>()),
  loadAuthUser: mocks.loadAuthUser,
  resolveActiveOrg: mocks.resolveActiveOrg,
  mfaEmDivida: async () => false,
}));
vi.mock("@/lib/supabase/server", () => {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    is: () => Promise.resolve({ data: mocks.agentes, error: null }),
  };
  // `requireRole` confirma o papel no BANCO (`fn_user_role_in_org`) — o mock responde viewer.
  const rpc = async (nome: string) => ({ data: nome === "fn_user_role_in_org" ? "viewer" : null, error: null });
  return { createClient: async () => ({ from: () => consulta, rpc }) };
});

import { AuthProvider } from "@/hooks/auth/AuthProvider";
import { useAutomaticoAtivo } from "@/hooks/ai/useAutomaticoAtivo";
import { GET } from "@/app/api/v1/ai/automatico-ativo/route";

const USUARIO = { id: "u-viewer", email: "v@exemplo.invalid" } as never;
const ORG = { orgId: "org-1", name: "Org", role: "viewer" as const };

beforeEach(() => {
  mocks.get.mockReset();
  mocks.get.mockResolvedValue({ data: { ativo: false } });
  mocks.loadAuthUser.mockResolvedValue({ id: "u-viewer", email: "v@exemplo.invalid", support: null });
  mocks.resolveActiveOrg.mockResolvedValue({ orgId: "org-1", name: "Org", role: "viewer" });
  mocks.agentes = [];
});

describe("viewer: a lista da fila usa o mesmo fato que o contador", () => {
  it("a tela PERGUNTA se há automático também para o viewer (antes ficava undefined)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <AuthProvider user={USUARIO} activeOrg={ORG as never}>{children}</AuthProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useAutomaticoAtivo(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/ai/automatico-ativo");
    expect(result.current.data).toBe(false);
  });

  it("a rota responde ao viewer com UM booleano — e nada de configuração de agente", async () => {
    mocks.agentes = [{ kind: "mcp_agent", is_active: true, paused_at: null, published_version_id: null, archived_at: null, system_prompt: "SEGREDO" }];
    const res = await GET(new Request("https://crm.exemplo.invalid/api/v1/ai/automatico-ativo") as never);
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(Object.keys(corpo.data)).toEqual(["ativo"]);
    expect(JSON.stringify(corpo)).not.toContain("SEGREDO");
  });

  it("controle: sem organização ativa, a rota continua negando", async () => {
    mocks.resolveActiveOrg.mockResolvedValue(null);
    const res = await GET(new Request("https://crm.exemplo.invalid/api/v1/ai/automatico-ativo") as never);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
