import { readFileSync } from "node:fs";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  BEFORE_SEND_GATES,
  runBeforeSend,
  type RunBeforeSendArgs,
} from "@/lib/agent-engine/guardrails/before-send";
import { retentionCopy } from "@/lib/inbox/retention-copy";

/**
 * QUEM ASSUMIU DURANTE A GERAÇÃO NÃO RECEBE A IA POR CIMA.
 *
 * Todo turno autônomo lê `isLeadInHandoff` no INÍCIO. Entre essa leitura e o envio
 * cabem o modelo, a pausa humana e a fila do número — segundos em que o atendente
 * clica "Assumir" (`bot_silenced_until = 'infinity'`), pausa, ou responde à mão
 * (silêncio deslizante de 5 min). A resposta gerada nesse intervalo saía assim mesmo:
 * o `stopGate` só relia `force_human`/`is_blocked`.
 *
 * A releitura mora na cadeia (`stopGate`, sob o lock do envio), e só é ARMADA por quem
 * declara fala autônoma (`revalidarSilencioDaIa`). Os avisos de passagem ficam de fora
 * de propósito: eles saem ANTES do silêncio, e a própria passagem o arma.
 */

type Opcoes = { silenciada?: boolean; bloqueado?: boolean };

function poolFalso(opcoes: Opcoes = {}) {
  const sqls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string): Promise<{ rows: unknown[] }> => {
      const s = String(sql).toLowerCase();
      sqls.push(s);
      if (s.includes("bot_silenced_until")) return { rows: [{ silenciada: opcoes.silenciada === true }] };
      if (s.includes("is_blocked")) return { rows: [{ stopped: opcoes.bloqueado === true }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn().mockResolvedValue({ rows: [{ id: "trace-1" }] }),
  };
  return { pool: pool as unknown as pg.Pool, sqls };
}

function args(pool: pg.Pool, extras: Partial<RunBeforeSendArgs> = {}): RunBeforeSendArgs {
  return {
    pool,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tenantId: "00000000-0000-4000-8000-000000000001",
    leadId: "00000000-0000-4000-8000-000000000002",
    jobId: "00000000-0000-4000-8000-000000000003",
    channelSessionId: "00000000-0000-4000-8000-000000000004",
    body: "A nota registrada é 8,5.",
    optedOutThisTurn: false,
    crmDailyLimit: null,
    now: new Date("2026-09-26T12:00:00.000Z"),
    rng: () => 0,
    sleep: async () => {},
    // Só o gate 1 — é ele que decide aqui, e a cadeia inteira pediria o estado de
    // pacing/janela/LGPD que este teste não é sobre.
    gates: [BEFORE_SEND_GATES[0]!],
    send: async () => ({ kind: "sent", idempotencyKey: "k", messageId: "m" }),
    ...extras,
  };
}

describe("revalidação do silêncio da IA no envio (T16)", () => {
  it("turno autônomo + humano assumiu durante a geração → veto ia_silenciada, nada enviado", async () => {
    const { pool } = poolFalso({ silenciada: true });
    const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));

    const r = await runBeforeSend(args(pool, { revalidarSilencioDaIa: true, send }));

    expect(r.status).toBe("vetoed");
    if (r.status === "vetoed") expect(r.code).toBe("ia_silenciada");
    expect(send).not.toHaveBeenCalled();
  });

  it("controle: turno autônomo sem silêncio → envia", async () => {
    const { pool } = poolFalso({ silenciada: false });
    const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));

    const r = await runBeforeSend(args(pool, { revalidarSilencioDaIa: true, send }));

    expect(r.status).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
  });

  it("sem a flag (aviso de passagem, resposta aprovada, reunião) o silêncio NÃO é lido nem barra", async () => {
    const { pool, sqls } = poolFalso({ silenciada: true });
    const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));

    const r = await runBeforeSend(args(pool, { send }));

    expect(r.status).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    expect(sqls.some((s) => s.includes("bot_silenced_until"))).toBe(false);
  });

  it("opt-out vence o silêncio no código do veto (a ação certa é nenhuma)", async () => {
    const { pool } = poolFalso({ silenciada: true, bloqueado: true });

    const r = await runBeforeSend(args(pool, { revalidarSilencioDaIa: true }));

    expect(r.status).toBe("vetoed");
    if (r.status === "vetoed") expect(r.code).toBe("contato_bloqueado");
  });

  it("a releitura NÃO usa dono: round robin atribui atendente sem calar a IA", async () => {
    const { pool, sqls } = poolFalso({ silenciada: false });

    await runBeforeSend(args(pool, { revalidarSilencioDaIa: true }));

    const leitura = sqls.find((s) => s.includes("bot_silenced_until"))!;
    expect(leitura).toBeDefined();
    expect(leitura).not.toContain("assigned_to_user_id");
    expect(leitura).not.toContain("assignee_kind");
  });
});

describe("quem arma a releitura (fiação)", () => {
  const ler = (p: string) => readFileSync(p, "utf8");
  const armadas = (src: string) => (src.match(/revalidarSilencioDaIa: true/g) ?? []).length;

  it("os três envios do turno de entrada e o envio fixo do follow-up armam", () => {
    expect(armadas(ler("lib/agent-engine/agent/inbound-turn.ts"))).toBe(3);
    expect(armadas(ler("lib/agent-engine/agent/followup-turn.ts"))).toBe(1);
  });

  it("aviso de passagem, resposta aprovada e reunião NÃO armam", () => {
    for (const p of [
      "lib/agent-engine/agent/aviso-de-escalacao.ts",
      "lib/agent-engine/agent/approved-reply.ts",
      "lib/agent-engine/agent/meet-delivery.ts",
    ]) {
      expect(armadas(ler(p)), p).toBe(0);
    }
  });
});

describe("a tela explica o veto", () => {
  it("ia_silenciada tem frase própria, não a genérica", () => {
    const c = retentionCopy("ia_silenciada", {
      window_start_hour: 7,
      window_end_hour: 22,
      allow_sunday: true,
      timezone: "America/Sao_Paulo",
    });
    expect(c.description).toContain("assumiu ou pausou");
    expect(c.description).not.toContain("trava de segurança");
  });
});
