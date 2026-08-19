import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * O bug real: convidado que vem de /team/accept-invite → "Fazer login" →
 * "Criar conta" confirma o e-mail em /auth/confirm igual a qualquer signup
 * self-service — e SEM esta checagem, ensureTenantForUser sempre roda,
 * provisionando uma organização NOVA pro convidado em vez de entrar na
 * organização que já existe (caso real: equipe@... virou admin de uma
 * organização própria vazia, nunca chegou na organização do convite).
 */

const ensureTenantForUser = vi.fn(async () => ({ provisioned: true, organizationId: "org-nova" }));
const auditSpy = vi.fn(async () => {});

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://crm.example.com" },
}));

vi.mock("@/lib/audit", () => ({
  audit: auditSpy,
}));

vi.mock("@/lib/auth/provision", () => ({
  ensureTenantForUser,
}));

let mockUser: { id: string; email: string } = { id: "u1", email: "convidado@empresa.com" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      verifyOtp: async () => ({ data: { user: mockUser }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: mockUser }, error: null }),
    },
  }),
}));

const { GET } = await import("@/app/auth/confirm/route");
const { signInviteToken } = await import("@/lib/auth/invite-token");

function req(query: string): NextRequest {
  return new NextRequest(`https://crm.example.com/auth/confirm?${query}`);
}

beforeEach(() => {
  ensureTenantForUser.mockClear();
  auditSpy.mockClear();
  mockUser = { id: "u1", email: "convidado@empresa.com" };
});

describe("/auth/confirm — convite não provisiona organização nova", () => {
  it("signup comum (sem invite) — provisiona normalmente, vai pro onboarding", async () => {
    const res = await GET(req("token_hash=abc&type=signup"));
    expect(ensureTenantForUser).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("https://crm.example.com/onboarding/welcome");
  });

  it("invite válido e e-mail bate — PULA o provisionamento, vai pro aceite do convite", async () => {
    const token = signInviteToken({
      invite_id: "inv-1",
      email: "convidado@empresa.com",
      organization_id: "org-real",
      role: "agent",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await GET(req(`token_hash=abc&type=signup&invite=${encodeURIComponent(token)}`));
    expect(ensureTenantForUser).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`https://crm.example.com/team/accept-invite/${token}`);
  });

  it("invite com e-mail DIFERENTE do que confirmou — ignora o invite, provisiona normalmente", async () => {
    const token = signInviteToken({
      invite_id: "inv-1",
      email: "outra-pessoa@empresa.com",
      organization_id: "org-real",
      role: "agent",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await GET(req(`token_hash=abc&type=signup&invite=${encodeURIComponent(token)}`));
    expect(ensureTenantForUser).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("https://crm.example.com/onboarding/welcome");
  });

  it("invite expirado/inválido — ignora e segue o fluxo normal (nunca quebra o signup comum)", async () => {
    const res = await GET(req("token_hash=abc&type=signup&invite=lixo-invalido"));
    expect(ensureTenantForUser).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("https://crm.example.com/onboarding/welcome");
  });
});
