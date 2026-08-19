import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { inboundMessageSuperseded, INBOUND_TURN_STALENESS_MS } from "@/lib/agent-engine/agent/inbound-turn";

/**
 * F: um hold longo (go-live, saúde degradada, sessão fora do ar) represa jobs de
 * inbound_turn e os libera de uma vez quando cai — sem esta checagem, o job
 * represado responde à mensagem CONGELADA no tempo que o originou, mesmo que um
 * humano já tenha resolvido a conversa enquanto o job esperava. Caso real desta
 * VPS: dono respondeu "Relaxa" pelo celular minutos depois do inbound, e ~16h
 * depois — quando o hold caiu — o bot "respondeu" à mensagem antiga do nada.
 */
function poolWith(rows: unknown[]): pg.Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as pg.Pool;
}

describe("inboundMessageSuperseded", () => {
  it("mensagem some do banco (ex.: apagada) — segue o fluxo normal, sem vetar o turno", async () => {
    const pool = poolWith([]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1");
    expect(result).toBeNull();
  });

  it("já existe mensagem mais nova na mesma conversa — a original já foi resolvida por outra coisa", async () => {
    const pool = poolWith([{ sent_at: new Date(), newer_count: "1" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1");
    expect(result).toEqual({ supersededBy: "newer_message", ageMs: 0 });
  });

  it("mensagem recente, sem nada mais novo — não é superada, turno segue normal", async () => {
    const recente = new Date(Date.now() - 5 * 60 * 1000); // 5 min atrás
    const pool = poolWith([{ sent_at: recente, newer_count: "0" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1");
    expect(result).toBeNull();
  });

  it("mensagem velha demais (represada por mais que o teto), sem nada mais novo — marca 'stale'", async () => {
    const velha = new Date(Date.now() - (INBOUND_TURN_STALENESS_MS + 60_000));
    const pool = poolWith([{ sent_at: velha, newer_count: "0" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1");
    expect(result?.supersededBy).toBe("stale");
    expect(result?.ageMs).toBeGreaterThan(INBOUND_TURN_STALENESS_MS);
  });

  it("mensagem já bem antiga mas AINDA dentro do teto — não veta (janela de tolerância normal)", async () => {
    const dentroDoTeto = new Date(Date.now() - (INBOUND_TURN_STALENESS_MS - 60_000));
    const pool = poolWith([{ sent_at: dentroDoTeto, newer_count: "0" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1");
    expect(result).toBeNull();
  });
});
