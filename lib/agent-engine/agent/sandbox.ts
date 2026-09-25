import type pg from "pg";
import { loadAgentVersionConfig } from "./agent-config";
import { runAgentPreview, type InboundTurnDeps } from "./inbound-turn";
import { newPreviewResult, scenarioContext } from "./preview";
import type { LeadContextMessage } from "../edge/crm/get-lead-context";

/** Um turno do transcript que o CLIENTE do chat de teste mantém e reenvia. */
export interface SandboxPriorTurn {
  role: "user" | "assistant";
  content: string;
}

export async function testAgentVersion(
  pool: pg.Pool,
  deps: InboundTurnDeps,
  input: {
    organizationId: string;
    agentId: string;
    versionId: string;
    runId: string;
    sampleMessage: string;
    sampleContact?: { name?: string; phone?: string };
    channelId: string | null;
    /**
     * Turnos anteriores da MESMA sessão de teste, na ordem em que aconteceram.
     * O run de teste nasce com `conversation_id: null` (não é conversa de
     * verdade — nada toca `contacts`/`conversations`), então não há de onde
     * carregar histórico do banco; o cliente do chat de teste (TestPanel,
     * onboarding/testar) é quem mantém o transcript e reenvia a cada chamada.
     * Ausente/vazio preserva o comportamento antigo: cada teste isolado.
     */
    priorTurns?: SandboxPriorTurn[];
  },
) {
  const agent = await loadAgentVersionConfig(
    pool,
    input.organizationId,
    input.agentId,
    input.versionId,
  );
  if (!agent) throw new Error("preview_version_unavailable");
  const result = newPreviewResult();
  const now = deps.clock?.() ?? new Date();
  const priorTurns = input.priorTurns ?? [];
  // sent_at sintético e CRESCENTE por turno — preserva a ORDEM (é o que os
  // gates de contexto/tempo leem), nunca o instante real: turno de teste não
  // tem horário de parede de verdade, só a sequência em que aconteceu.
  const priorMessages: LeadContextMessage[] = priorTurns.map((turno, i) => ({
    direction: turno.role === "user" ? "inbound" : "outbound",
    body: turno.content,
    sent_at: new Date(now.getTime() - (priorTurns.length - i) * 1000).toISOString(),
  }));
  const context = scenarioContext(
    [
      ...priorMessages,
      {
        direction: "inbound",
        body: input.sampleMessage,
        sent_at: now.toISOString(),
      },
    ],
    input.sampleContact,
  );
  await runAgentPreview(deps, pool, {
    kind: "sandbox",
    organizationId: input.organizationId,
    runId: input.runId,
    agent,
    context,
    contactId: null,
    channelId: input.channelId,
    result,
  });
  return result;
}
