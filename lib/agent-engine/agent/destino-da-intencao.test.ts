import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HandlerCtx } from "@/lib/api/handlers/types";

// A transferência é o EFEITO observável: mockada aqui, e SEMPRE a mesma que a
// automação chama — se este teste passasse com outra implementação, seria papel
// no lugar do defeito (#2155).
vi.mock("@/lib/leads/transfere-para-o-funil", () => ({
  COLUNAS_DA_ORIGEM: "id, pipeline_id, status, contact_id",
  transfereParaOFunil: vi.fn(async () => ({ ok: true, clone: { id: "clone-1" } })),
}));

import { transfereParaOFunil } from "@/lib/leads/transfere-para-o-funil";

import { aplicaDestinoDaIntencao } from "./destino-da-intencao";

const transferir = vi.mocked(transfereParaOFunil);

const handlerCtx: HandlerCtx = {
  organization_id: "org-1",
  actor: { type: "ai_agent", id: "job-1", role: "ai_operator", agent_id: "agent-vendas" },
  requestId: "job-1",
};

/** Supabase fake: `from().select().eq().eq().eq()` resolve com as linhas dadas. */
function adminCom(linhas: unknown[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: async () => ({ data: linhas, error: null }) }) }),
      }),
    }),
  } as never;
}

function negocio(id: string, pipeline: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: "org-1",
    pipeline_id: pipeline,
    status: "open",
    contact_id: "c1",
    last_activity_at: "2026-10-04T12:00:00+00:00",
    created_at: "2026-10-01T12:00:00+00:00",
    title: "Negócio",
    description: null,
    value_cents: null,
    currency: "BRL",
    owner_user_id: null,
    owner_agent_id: null,
    expected_close_date: null,
    tags: [],
    source: null,
    custom_fields: {},
    source_metadata: {},
    ...extra,
  };
}

function deps(admin: never, destinoPipelineId = "pipe-b", destinoStageId: string | null = "stage-b1") {
  return {
    admin,
    organizationId: "org-1",
    contactId: "c1",
    destinoPipelineId,
    destinoStageId,
    handlerCtx,
  };
}

describe("aplicaDestinoDaIntencao (#2155 — o card vai para o funil da intenção)", () => {
  beforeEach(() => transferir.mockClear());

  it("card no funil de ENTRADA, destino declarado → transfere para o funil destino", async () => {
    const r = await aplicaDestinoDaIntencao(deps(adminCom([negocio("lead-1", "pipe-entrada")])));

    expect(r.status).toBe("transferido");
    expect(r.origemId).toBe("lead-1");
    expect(r.cloneId).toBe("clone-1");
    expect(transferir).toHaveBeenCalledTimes(1);
    // O QUE prende o defeito: destino É o funil da intenção, nunca o de entrada.
    expect(transferir.mock.calls[0]![3]).toMatchObject({ id: "lead-1", pipeline_id: "pipe-entrada" });
    expect(transferir.mock.calls[0]![4]).toBe("pipe-b");
    expect(transferir.mock.calls[0]![5]).toBe("stage-b1");
    // A linha do tempo diz QUEM levou o card: o roteador, não "a automação".
    expect(transferir.mock.calls[0]![6]).toBe("Levado para outro funil pelo roteador de intenção");
  });

  it("card JÁ no funil destino → nada a fazer (idempotente em toda mensagem seguinte)", async () => {
    const r = await aplicaDestinoDaIntencao(deps(adminCom([negocio("lead-1", "pipe-b")])));

    expect(r.status).toBe("ja_no_destino");
    expect(transferir).not.toHaveBeenCalled();
  });

  it("destino já com OUTRO negócio aberto → não duplica o card do cliente", async () => {
    const r = await aplicaDestinoDaIntencao(
      deps(adminCom([negocio("lead-1", "pipe-entrada"), negocio("lead-2", "pipe-b")])),
    );

    expect(r.status).toBe("destino_ocupado");
    expect(transferir).not.toHaveBeenCalled();
  });

  it("sem negócio aberto → sem card a mover, nunca lança", async () => {
    const r = await aplicaDestinoDaIntencao(deps(adminCom([])));

    expect(r.status).toBe("sem_negocio");
    expect(transferir).not.toHaveBeenCalled();
  });

  it("a transferência recusou (etapa de outro funil) → recusado com o código, sem exceção", async () => {
    transferir.mockResolvedValueOnce({ ok: false, error: "stage_pipeline_mismatch" });

    const r = await aplicaDestinoDaIntencao(deps(adminCom([negocio("lead-1", "pipe-entrada")])));

    expect(r.status).toBe("recusado");
    expect(r.error).toBe("stage_pipeline_mismatch");
  });

  it("sem etapa declarada → manda null e a transferência escolhe a primeira aberta", async () => {
    await aplicaDestinoDaIntencao(
      deps(adminCom([negocio("lead-1", "pipe-entrada")]), "pipe-b", null),
    );

    expect(transferir.mock.calls[0]![5]).toBeNull();
  });
});
