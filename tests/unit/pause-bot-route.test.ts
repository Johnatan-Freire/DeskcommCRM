import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";

/**
 * POST /api/v1/conversations/[id]/pause-bot — o oposto de reactivate-bot.
 * Reusa triggerHandoff (já usado pelos gatilhos automáticos G1-G4) com
 * reason='manual_pause'; a rota só resolve auth, valida a conversa e acha o
 * leadId opcional pra timeline.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/ai/handoff/orchestrator", () => ({ triggerHandoff: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";

function mockSupabase(convRow: Record<string, unknown> | null, leads: Record<string, unknown>[] = []) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    from(table: string) {
      if (table === "conversations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: convRow, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "crm_leads") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: leads, error: null }),
            }),
          }),
        };
      }
      if (table === "crm_pipelines") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada no teste: ${table}`);
    },
  });
}

function req() {
  return new NextRequest(`https://x.test/api/v1/conversations/${CONV}/pause-bot`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireRole as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    user: { id: "u-1" },
    org: { orgId: ORG, role: "agent" },
  });
  (triggerHandoff as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    triggered: true,
    reason: "manual_pause",
  });
});

describe("POST /conversations/[id]/pause-bot", () => {
  it("conversa aberta, sem lead: chama triggerHandoff com reason='manual_pause' e leadId null", async () => {
    mockSupabase({ id: CONV, contact_id: CONTACT, status: "open" }, []);
    const { POST } = await import("@/app/api/v1/conversations/[id]/pause-bot/route");
    const res = await POST(req(), { params: Promise.resolve({ id: CONV }) });
    expect(res.status).toBe(200);
    expect(triggerHandoff).toHaveBeenCalledWith({
      conversationId: CONV,
      organizationId: ORG,
      reason: "manual_pause",
      leadId: null,
    });
  });

  it("conversa não encontrada — 404, nunca chama triggerHandoff", async () => {
    mockSupabase(null);
    const { POST } = await import("@/app/api/v1/conversations/[id]/pause-bot/route");
    const res = await POST(req(), { params: Promise.resolve({ id: CONV }) });
    expect(res.status).toBe(404);
    expect(triggerHandoff).not.toHaveBeenCalled();
  });

  it("conversa fechada — recusa pausar, nunca chama triggerHandoff", async () => {
    mockSupabase({ id: CONV, contact_id: CONTACT, status: "closed" });
    const { POST } = await import("@/app/api/v1/conversations/[id]/pause-bot/route");
    const res = await POST(req(), { params: Promise.resolve({ id: CONV }) });
    expect(res.status).toBe(409);
    expect(triggerHandoff).not.toHaveBeenCalled();
  });

  it("sem permissão (role < agent) — devolve a resposta de authz, nunca chama triggerHandoff", async () => {
    const failResponse = new Response(null, { status: 403 });
    (requireRole as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      response: failResponse,
    });
    const { POST } = await import("@/app/api/v1/conversations/[id]/pause-bot/route");
    const res = await POST(req(), { params: Promise.resolve({ id: CONV }) });
    expect(res.status).toBe(403);
    expect(triggerHandoff).not.toHaveBeenCalled();
  });
});
