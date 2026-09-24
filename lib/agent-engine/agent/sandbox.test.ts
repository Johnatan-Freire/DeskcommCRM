import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("./agent-config", () => ({
  loadAgentVersionConfig: vi.fn(async () => ({ id: "v1" }) as unknown),
}));

let capturedContext: unknown;
vi.mock("./inbound-turn", () => ({
  runAgentPreview: vi.fn(async (_deps: unknown, _pool: unknown, args: { context: unknown }) => {
    capturedContext = args.context;
  }),
}));

import { testAgentVersion } from "./sandbox";

/**
 * O run de teste ("Testar agente") nasce com `conversation_id: null` — não há
 * histórico pra carregar do banco. `priorTurns` é o transcript que o CLIENTE
 * (TestPanel, onboarding/testar) mantém e reenvia a cada chamada; sem isto,
 * mandar "mensagem 2" logo após "1" chegava ao agente sem contexto nenhum.
 */
describe("testAgentVersion — continuidade via priorTurns", () => {
  it("sem priorTurns: só a sampleMessage vira contexto (comportamento antigo preservado)", async () => {
    const pool = {} as pg.Pool;
    const deps = { clock: () => new Date("2026-09-24T12:00:00Z") } as never;
    await testAgentVersion(pool, deps, {
      organizationId: "org-1",
      agentId: "agent-1",
      versionId: "v1",
      runId: "run-1",
      sampleMessage: "quanto custa",
      channelId: null,
    });
    const ctx = capturedContext as { context: { messages: { direction: string; body: string }[] } };
    expect(ctx.context.messages).toEqual([
      { direction: "inbound", body: "quanto custa", sent_at: "2026-09-24T12:00:00.000Z" },
    ]);
  });

  it("com priorTurns: mapeia role→direction e preserva a ORDEM antes da sampleMessage", async () => {
    const pool = {} as pg.Pool;
    const deps = { clock: () => new Date("2026-09-24T12:00:00Z") } as never;
    await testAgentVersion(pool, deps, {
      organizationId: "org-1",
      agentId: "agent-1",
      versionId: "v1",
      runId: "run-1",
      sampleMessage: "quanto custa",
      channelId: null,
      priorTurns: [
        { role: "user", content: "oi, vocês têm o curso de X?" },
        { role: "assistant", content: "temos sim! quer saber o valor?" },
      ],
    });
    const ctx = capturedContext as {
      context: { messages: { direction: string; body: string; sent_at: string }[] };
    };
    expect(ctx.context.messages.map((m) => ({ direction: m.direction, body: m.body }))).toEqual([
      { direction: "inbound", body: "oi, vocês têm o curso de X?" },
      { direction: "outbound", body: "temos sim! quer saber o valor?" },
      { direction: "inbound", body: "quanto custa" },
    ]);
    // Ordem cronológica estritamente crescente — os gates de contexto/tempo
    // do motor leem `sent_at` para decidir o que é "mais novo".
    const instantes = ctx.context.messages.map((m) => Date.parse(m.sent_at));
    expect(instantes[0]).toBeLessThan(instantes[1]!);
    expect(instantes[1]).toBeLessThan(instantes[2]!);
  });
});
