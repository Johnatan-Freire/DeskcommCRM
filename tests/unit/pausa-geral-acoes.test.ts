/**
 * Pausa geral (auditoria de agentes) — as AÇÕES de servidor, com papel e banco
 * simulados: quem pode o quê, e o que cada uma grava.
 *
 *  - agentes: pausar/retomar todos = admin; retomar em lote só religa quem tem
 *    versão publicada; uma linha de auditoria por agente (em_lote);
 *  - follow-ups: pausar = manager+; retomar = admin (religa envio automático).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = { tabela: string; op: string; valores?: unknown; filtros: Array<[string, string, unknown]> };

const estado = vi.hoisted(() => ({
  papel: "admin" as string,
  chamadas: [] as Chamada[],
  respostas: new Map<string, unknown>(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: "22222222-2222-4222-8222-222222222222", role: estado.papel })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      const c: Chamada = { tabela, op: "select", filtros: [] };
      estado.chamadas.push(c);
      const b = {
        select() { return b; },
        update(v: unknown) { c.op = "update"; c.valores = v; return b; },
        eq(k: string, v: unknown) { c.filtros.push([k, "eq", v]); return b; },
        is(k: string, v: unknown) { c.filtros.push([k, "is", v]); return b; },
        not(k: string, op: string, v: unknown) { c.filtros.push([k, `not.${op}`, v]); return b; },
        in(k: string, v: unknown) { c.filtros.push([k, "in", v]); return b; },
        then(ok: (r: unknown) => unknown) {
          return Promise.resolve(estado.respostas.get(`${tabela}:${c.op}`) ?? { data: [], error: null }).then(ok);
        },
      };
      return b;
    },
  }),
}));

import { audit } from "@/lib/audit";
import { pauseAllAgentsAction, unpauseAllAgentsAction } from "@/app/app/ai/agents/_actions";
import { pausarTodosOsFollowupsAction, retomarTodosOsFollowupsAction } from "@/app/app/ai/followups/_actions";

beforeEach(() => {
  estado.papel = "admin";
  estado.chamadas = [];
  estado.respostas.clear();
  vi.mocked(audit).mockClear();
});

describe("agentes — pausar todos", () => {
  it("manager não pode", async () => {
    estado.papel = "manager";
    expect(await pauseAllAgentsAction()).toEqual({ ok: false, error: "forbidden_role" });
    expect(estado.chamadas).toEqual([]);
  });

  it("admin pausa só os não arquivados e não pausados da PRÓPRIA organização, com auditoria por agente", async () => {
    estado.respostas.set("ai_agents:update", { data: [{ id: "a1", published_version_id: "v1" }, { id: "a2", published_version_id: null }], error: null });
    expect(await pauseAllAgentsAction()).toEqual({ ok: true, data: { pausados: 2 } });
    const upd = estado.chamadas.find((c) => c.op === "update")!;
    expect(upd.valores).toMatchObject({ paused_at: expect.any(String) });
    expect(upd.filtros).toEqual(
      expect.arrayContaining([
        ["organization_id", "eq", "22222222-2222-4222-8222-222222222222"],
        ["archived_at", "is", null],
        ["paused_at", "is", null],
      ]),
    );
    expect(vi.mocked(audit)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "ai_agent.paused", metadata: { em_lote: true } });
  });
});

describe("agentes — retomar todos", () => {
  it("⭐ só religa quem tem versão publicada; conta os que ficaram de fora", async () => {
    estado.respostas.set("ai_agents:select", {
      data: [{ id: "pub", published_version_id: "v1" }, { id: "rascunho", published_version_id: null }],
      error: null,
    });
    estado.respostas.set("ai_agents:update", { data: [{ id: "pub" }], error: null });
    expect(await unpauseAllAgentsAction()).toEqual({ ok: true, data: { retomados: 1, sem_versao_publicada: 1 } });
    const upd = estado.chamadas.find((c) => c.op === "update")!;
    expect(upd.valores).toMatchObject({ paused_at: null });
    expect(upd.filtros).toEqual(expect.arrayContaining([["id", "in", ["pub"]]]));
  });

  it("nenhum publicado: não escreve nada", async () => {
    estado.respostas.set("ai_agents:select", { data: [{ id: "r", published_version_id: null }], error: null });
    expect(await unpauseAllAgentsAction()).toEqual({ ok: true, data: { retomados: 0, sem_versao_publicada: 1 } });
    expect(estado.chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("agent não pode", async () => {
    estado.papel = "agent";
    expect(await unpauseAllAgentsAction()).toEqual({ ok: false, error: "forbidden_role" });
  });
});

describe("follow-ups — pausa geral", () => {
  it("manager PAUSA (ato de segurança)", async () => {
    estado.papel = "manager";
    expect(await pausarTodosOsFollowupsAction()).toEqual({ ok: true });
    const upd = estado.chamadas.find((c) => c.op === "update")!;
    expect(upd.tabela).toBe("organizations");
    expect(upd.valores).toMatchObject({ followups_pausados_em: expect.any(String), followups_pausados_por: "11111111-1111-4111-8111-111111111111" });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "followups.paused_all" });
  });

  it("⭐ manager NÃO retoma (religar envio automático é do admin)", async () => {
    estado.papel = "manager";
    expect(await retomarTodosOsFollowupsAction()).toEqual({ ok: false, error: "forbidden_role" });
    expect(estado.chamadas).toEqual([]);
  });

  it("admin retoma e limpa quem pausou", async () => {
    expect(await retomarTodosOsFollowupsAction()).toEqual({ ok: true });
    const upd = estado.chamadas.find((c) => c.op === "update")!;
    expect(upd.valores).toEqual({ followups_pausados_em: null, followups_pausados_por: null });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "followups.resumed_all" });
  });

  it("agent não pausa", async () => {
    estado.papel = "agent";
    expect(await pausarTodosOsFollowupsAction()).toEqual({ ok: false, error: "forbidden_role" });
  });
});
