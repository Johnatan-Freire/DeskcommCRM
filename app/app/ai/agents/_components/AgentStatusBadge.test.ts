import { describe, it, expect } from "vitest";

import { deriveAgentStatus } from "./AgentStatusBadge";
import type { AgentRow } from "@/hooks/ai/useAgent";

const base = {
  id: "a", organization_id: "o", name: "Atendente IA", description: null,
  model: "anthropic/claude-sonnet-4-6", system_prompt: "oi", is_active: true,
  is_default: true, kind: "rag_bot", priority: 0, published_version_id: null,
  archived_at: null, config: {}, guardrails: {}, active_kb_version_id: null,
  created_at: "", updated_at: "",
} as unknown as AgentRow;

describe("deriveAgentStatus", () => {
  it("sem versão publicada é RASCUNHO, mesmo ativo", () => {
    // O defeito de origem: o agente criado no onboarding (rag_bot, ativo, sem
    // versão) aparecia como "Publicado" enquanto os dois runtimes o ignoram —
    // ambos resolvem o agente por join com ai_agent_versions.
    expect(deriveAgentStatus({ ...base, is_active: true, published_version_id: null })).toBe("draft");
    expect(deriveAgentStatus({ ...base, kind: "mcp_agent", published_version_id: null } as AgentRow)).toBe("draft");
  });

  it("com versão publicada e ativo é PUBLICADO", () => {
    expect(deriveAgentStatus({ ...base, published_version_id: "v1" } as AgentRow)).toBe("published");
  });

  it("com versão publicada e inativo é PAUSADO (rag_bot legado)", () => {
    expect(deriveAgentStatus({ ...base, published_version_id: "v1", is_active: false } as AgentRow)).toBe("paused");
  });

  it("mcp_agent publicado e inativo é PAUSADO — igual ao rag_bot agora", () => {
    // is_active passou a valer pros dois kinds (antes só o rag_bot lia essa
    // coluna, e os dois runtimes de dispatch — lib/ai/dispatcher e
    // lib/agent-engine/agent/agent-config — ignoravam is_active pra
    // mcp_agent). O design antigo evitava mostrar "Pausado" sem saída pela UI
    // (Despausar ficava disabled, unpauseAgentAction recusava com
    // publish_required) — mas o preço foi pior: "Pausar" continuava
    // funcionando pra mcp_agent, só que DESPUBLICANDO de verdade
    // (published_version_id = null), e a volta exigia reverter para uma
    // versão anterior, que por sua vez exige o canal WhatsApp online. Caso
    // real: dois agentes de produção ficaram fora do ar até o número
    // reconectar, só porque alguém clicou "Pausar" pra testar o botão. Agora
    // pausar é só is_active=false (published_version_id intacto), e os dois
    // runtimes de dispatch respeitam a coluna — pausa e retomada instantâneas,
    // sem tocar em versão nem depender de canal online.
    expect(
      deriveAgentStatus({
        ...base,
        kind: "mcp_agent",
        published_version_id: "v1",
        is_active: false,
      } as AgentRow),
    ).toBe("paused");
  });

  it("arquivado vence tudo", () => {
    expect(deriveAgentStatus({ ...base, archived_at: "2026-01-01", published_version_id: "v1" } as AgentRow)).toBe("archived");
  });
});
