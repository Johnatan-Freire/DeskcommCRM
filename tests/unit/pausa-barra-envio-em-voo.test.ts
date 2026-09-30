/**
 * PAUSAR O AGENTE ENQUANTO ELE GERA DESCARTA A RESPOSTA ANTES DO ENVIO.
 *
 * O turno carimba a operação do agente que o começou (`agentOperation`: versão
 * publicada + `operation_revision`) e o handler a reconfere no `beforeSend`, o
 * último instante antes do canal (`app/api/v1/messages/_handler.ts`,
 * `checkBoundary`). Esta é a regra dessa reconferência: qualquer mudança de
 * autoridade entre o começo da geração e o envio — pausa, despublicação, troca
 * de modo, arquivamento, nova revisão — derruba o envio com
 * `StaleServiceBoundaryError`, que o handler repassa sem gravar `sent`.
 */
import { describe, expect, it } from "vitest";

import { assertAgentOperationPg, type AgentOperationContext } from "@/lib/ai/agents/operation";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";

const OP: AgentOperationContext = { organizationId: "org", agentId: "agente", versionId: "v1", revision: "7" };

const NO_AR = {
  published_version_id: "v1",
  operation_revision: "7",
  operation_mode: "automatic",
  paused_at: null as string | null,
  archived_at: null as string | null,
};

const banco = (linha: Record<string, unknown> | undefined) => ({
  query: async () => ({ rows: linha ? [linha] : [] }),
});

describe("pausa × resposta em voo", () => {
  it("A · agente publicado e no ar: a resposta gerada pode sair", async () => {
    await expect(assertAgentOperationPg(banco(NO_AR) as never, OP)).resolves.toBeUndefined();
  });

  it.each([
    ["C · pausado durante a geração", { paused_at: "2026-09-29T17:00:00Z" }],
    ["despublicado durante a geração", { published_version_id: null }],
    ["outra versão publicada durante a geração", { published_version_id: "v2" }],
    ["operação revisada (pausa + despausa) durante a geração", { operation_revision: "8" }],
    ["trocado para assistido durante a geração", { operation_mode: "assisted" }],
    ["arquivado durante a geração", { archived_at: "2026-09-29T17:00:00Z" }],
  ])("%s → envio descartado", async (_caso, mudanca) => {
    await expect(assertAgentOperationPg(banco({ ...NO_AR, ...mudanca }) as never, OP)).rejects.toBeInstanceOf(
      StaleServiceBoundaryError,
    );
  });

  it("agente apagado durante a geração → envio descartado", async () => {
    await expect(assertAgentOperationPg(banco(undefined) as never, OP)).rejects.toBeInstanceOf(StaleServiceBoundaryError);
  });

  it("o handler reconfere a operação no beforeSend, depois de a trava global deixar passar", async () => {
    const { readFileSync } = await import("node:fs");
    const handler = readFileSync("app/api/v1/messages/_handler.ts", "utf8");
    const checkBoundary = handler.slice(handler.indexOf("const checkBoundary = async () => {"));
    expect(checkBoundary.slice(0, 800)).toMatch(/if \(ctx\.agentOperation\) await assertAgentOperationSupabase/);
  });
});
