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
 *
 * A idade que conta é a do JOB (`jobCreatedAt`), não a da mensagem (`sent_at`)
 * — ver o doc-comment de `inboundMessageSuperseded`. As duas coincidem no caso
 * acima (job nasce junto com a mensagem, fica retido), mas divergem no
 * reengajamento por template: ali um job FRESCO responde a uma mensagem velha
 * por natureza (é o que abre a janela de 24h fechada), e usar `sent_at` vetava
 * esse turno legítimo com o motivo do incidente — medido em
 * tests/invariants/agent-send-template-turn.test.ts.
 */
function poolWith(rows: unknown[]): pg.Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as pg.Pool;
}

describe("inboundMessageSuperseded", () => {
  it("mensagem some do banco (ex.: apagada) — segue o fluxo normal, sem vetar o turno", async () => {
    const pool = poolWith([]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1", new Date());
    expect(result).toBeNull();
  });

  it("já existe mensagem mais nova na mesma conversa — a original já foi resolvida por outra coisa", async () => {
    const pool = poolWith([{ sent_at: new Date(), newer_count: "1" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1", new Date());
    expect(result).toEqual({ supersededBy: "newer_message", ageMs: 0 });
  });

  it("job recente, sem nada mais novo — não é superado, turno segue normal", async () => {
    const jobRecente = new Date(Date.now() - 5 * 60 * 1000); // 5 min atrás
    const pool = poolWith([{ sent_at: jobRecente, newer_count: "0" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1", jobRecente);
    expect(result).toBeNull();
  });

  it("job velho demais (represado por mais que o teto), sem nada mais novo — marca 'stale'", async () => {
    const jobVelho = new Date(Date.now() - (INBOUND_TURN_STALENESS_MS + 60_000));
    const pool = poolWith([{ sent_at: jobVelho, newer_count: "0" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1", jobVelho);
    expect(result?.supersededBy).toBe("stale");
    expect(result?.ageMs).toBeGreaterThan(INBOUND_TURN_STALENESS_MS);
  });

  it("job já bem antigo mas AINDA dentro do teto — não veta (janela de tolerância normal)", async () => {
    const dentroDoTeto = new Date(Date.now() - (INBOUND_TURN_STALENESS_MS - 60_000));
    const pool = poolWith([{ sent_at: dentroDoTeto, newer_count: "0" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1", dentroDoTeto);
    expect(result).toBeNull();
  });

  it("mensagem velha por NATUREZA (reengajamento fora da janela de 24h) mas job FRESCO — não veta", async () => {
    // A regressão que esta guarda causou: um job criado AGORA para responder a uma
    // mensagem de 30h atrás (janela de 24h fechada, fluxo normal de template) não é
    // um job represado — é um job novo processando conteúdo antigo de propósito.
    const mensagemDe30h = new Date(Date.now() - 30 * 60 * 60 * 1000);
    const jobCriadoAgora = new Date();
    const pool = poolWith([{ sent_at: mensagemDe30h, newer_count: "0" }]);
    const result = await inboundMessageSuperseded(pool, "org-1", "conv-1", "msg-1", jobCriadoAgora);
    expect(result).toBeNull();
  });
});
