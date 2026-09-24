import { describe, expect, it } from "vitest";

import { __test_fitToBudget } from "@/lib/agent-engine/edge/crm/get-lead-context";

/**
 * F: uma mensagem outbound sem sender_kind chegava ao modelo indistinguível
 * de algo que ELE MESMO teria dito — caso real: o dono da conta respondeu
 * "Te amo" manualmente pelo celular numa conversa de teste, e o agente,
 * lendo isso como fala própria, passou o atendimento pra um humano sozinho
 * (achando que precisava de revisão por ter "dito algo estranho").
 *
 * sender_kind distingue outbound da IA ('ai', quando sent_via='ai') de
 * outbound de um humano digitando pelo mesmo número ('human_agent', qualquer
 * outro sent_via — external_device, crm, user, automation, system). Inbound
 * nunca carrega o campo — é sempre o próprio lead, não se aplica.
 */
describe("fitToBudget — sender_kind distingue IA de humano no outbound", () => {
  const base = {
    lead_id: "l1",
    contact: { name: "x", phone: null, email: null, tags: [], is_blocked: false },
    conversation_id: "c1",
    last_human_decision: null,
  };

  it("outbound com sent_via='ai' vira sender_kind 'ai'", () => {
    const ctx = __test_fitToBudget(
      base,
      [
        {
          direction: "outbound",
          type: "text",
          body: "Olá! Como posso ajudar?",
          media_url: null,
          media_storage_path: null,
          media_mime: null,
          media_derived_text: null,
          sent_at: new Date("2026-08-20T10:00:00Z"),
          sent_via: "ai",
        },
      ],
      100000,
      "UTC",
    );
    expect(ctx.messages[0]!.sender_kind).toBe("ai");
  });

  it("outbound digitado manualmente (external_device) vira sender_kind 'human_agent'", () => {
    const ctx = __test_fitToBudget(
      base,
      [
        {
          direction: "outbound",
          type: "text",
          body: "Te amo",
          media_url: null,
          media_storage_path: null,
          media_mime: null,
          media_derived_text: null,
          sent_at: new Date("2026-08-20T10:00:00Z"),
          sent_via: "external_device",
        },
      ],
      100000,
      "UTC",
    );
    expect(ctx.messages[0]!.sender_kind).toBe("human_agent");
  });

  it("inbound nunca carrega sender_kind — é sempre o lead, não se aplica", () => {
    const ctx = __test_fitToBudget(
      base,
      [
        {
          direction: "inbound",
          type: "text",
          body: "oi",
          media_url: null,
          media_storage_path: null,
          media_mime: null,
          media_derived_text: null,
          sent_at: new Date("2026-08-20T10:00:00Z"),
          sent_via: null,
        },
      ],
      100000,
      "UTC",
    );
    expect(ctx.messages[0]!.sender_kind).toBeUndefined();
  });
});
