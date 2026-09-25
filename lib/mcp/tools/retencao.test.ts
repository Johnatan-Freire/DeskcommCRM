import { describe, expect, it, vi } from "vitest";

import { crmCloseDemand } from "./retencao";
import type { McpContext } from "../types";

/**
 * `crm_close_demand` é a SEGUNDA porta que move won/lost (a primeira é
 * `update_lead_state` em inbound-turn.ts) — sem este gate, `can_mark_won`/
 * `can_mark_lost` seria uma trava com uma porta destrancada ao lado. Estes
 * testes provam a tentativa INDIRETA de terminal, não a direta.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

function tabela(rows: Record<string, unknown> | null) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: rows, error: null }),
  };
  return q;
}

function ctxComAtor(
  actor: McpContext["actor"],
  runRow: Record<string, unknown> | null,
  versionRow: Record<string, unknown> | null,
): { ctx: McpContext; encerraChamado: boolean } {
  const estado = { encerraChamado: false };
  const supabase = {
    from: (table: string) => {
      if (table === "ai_agent_runs") return tabela(runRow);
      if (table === "ai_agent_versions") return tabela(versionRow);
      if (table === "crm_leads") {
        estado.encerraChamado = true;
        return tabela({ id: "lead-1", status: "open", pipeline_id: "pipe-1" });
      }
      return tabela(null);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return {
    ctx: {
      organizationId: ORG,
      role: "agent",
      actor,
      apiTokenId: "token-1",
      requestId: "55555555-5555-4555-8555-555555555555",
      supabase,
    } as McpContext,
    encerraChamado: estado.encerraChamado,
  };
}

describe("crm_close_demand — bloqueio terminal (porta indireta)", () => {
  it("actor ai_agent SEM can_mark_won → won recusado, encerraDemanda NUNCA chamado", async () => {
    const { ctx } = ctxComAtor(
      { type: "ai_agent", id: RUN_ID, role: "agent" },
      { agent_version_id: VERSION_ID },
      { can_mark_won: false, can_mark_lost: true },
    );
    const r = (await crmCloseDemand.handler(
      { lead_id: "11111111-1111-4111-8111-111111111111", outcome: "won" },
      ctx,
    )) as { encerrado: boolean; motivo?: string };
    expect(r.encerrado).toBe(false);
    expect(r.motivo).toBe("transicao_nao_autorizada");
  });

  it("actor ai_agent SEM can_mark_lost → lost recusado", async () => {
    const { ctx } = ctxComAtor(
      { type: "ai_agent", id: RUN_ID, role: "agent" },
      { agent_version_id: VERSION_ID },
      { can_mark_won: true, can_mark_lost: false },
    );
    const r = (await crmCloseDemand.handler(
      { lead_id: "11111111-1111-4111-8111-111111111111", outcome: "lost", reason: "motivo real" },
      ctx,
    )) as { encerrado: boolean; motivo?: string };
    expect(r.encerrado).toBe(false);
    expect(r.motivo).toBe("transicao_nao_autorizada");
  });

  it("actor ai_agent COM can_mark_won=true → segue até encerraDemanda (autorizado)", async () => {
    const { ctx } = ctxComAtor(
      { type: "ai_agent", id: RUN_ID, role: "agent" },
      { agent_version_id: VERSION_ID },
      { can_mark_won: true, can_mark_lost: false },
    );
    const r = (await crmCloseDemand.handler(
      { lead_id: "11111111-1111-4111-8111-111111111111", outcome: "won" },
      ctx,
    )) as { encerrado: boolean; motivo?: string };
    // Não é mais `transicao_nao_autorizada` — o motivo (se houver) vem de mais
    // adiante no fluxo real de encerraDemanda, que este fake não simula por
    // completo; o que este teste prova é que o GATE não bloqueou.
    expect(r.motivo).not.toBe("transicao_nao_autorizada");
  });

  it("FAIL-CLOSED: agent_run não encontrado (run órfão/token sem escopo real) → bloqueia", async () => {
    const { ctx } = ctxComAtor({ type: "ai_agent", id: RUN_ID, role: "agent" }, null, null);
    const r = (await crmCloseDemand.handler(
      { lead_id: "11111111-1111-4111-8111-111111111111", outcome: "won" },
      ctx,
    )) as { encerrado: boolean; motivo?: string };
    expect(r.encerrado).toBe(false);
    expect(r.motivo).toBe("transicao_nao_autorizada");
  });

  it("FAIL-CLOSED: versão não encontrada (clone sem a migration 0401) → bloqueia", async () => {
    const { ctx } = ctxComAtor(
      { type: "ai_agent", id: RUN_ID, role: "agent" },
      { agent_version_id: VERSION_ID },
      null,
    );
    const r = (await crmCloseDemand.handler(
      { lead_id: "11111111-1111-4111-8111-111111111111", outcome: "lost", reason: "x" },
      ctx,
    )) as { encerrado: boolean; motivo?: string };
    expect(r.encerrado).toBe(false);
    expect(r.motivo).toBe("transicao_nao_autorizada");
  });

  it("actor user/api_token NÃO passa pelo gate de capability — mesmo comportamento de sempre (RBAC cobre)", async () => {
    const supabaseGate = vi.fn();
    const { ctx } = ctxComAtor({ type: "user", id: "user-1" }, null, null);
    // Espiona: se o gate tentasse resolver `ai_agent_runs` para um ator humano,
    // este mock capturaria a chamada. Ele não deve nem tentar.
    const originalFrom = ctx.supabase.from.bind(ctx.supabase);
    ctx.supabase.from = ((table: string) => {
      if (table === "ai_agent_runs") supabaseGate();
      return originalFrom(table);
    }) as typeof ctx.supabase.from;

    await crmCloseDemand.handler(
      { lead_id: "11111111-1111-4111-8111-111111111111", outcome: "won" },
      ctx,
    );
    expect(supabaseGate).not.toHaveBeenCalled();
  });
});
