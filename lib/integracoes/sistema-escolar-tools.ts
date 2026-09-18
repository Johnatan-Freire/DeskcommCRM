/**
 * Os dois tool ids do sistema escolar, na grafia EXATA usada em
 * `AGENT_TOOL_DEFS` (lib/agent-engine/agent/inbound-turn.ts) — mesmo domínio de
 * `ai_agent_versions.sistema_escolar_tool_ids`, validado contra esta lista em
 * `lib/ai/agents/validation.ts`.
 *
 * Vive num arquivo próprio, sem `pg` nem `@/lib/crypto`, porque
 * `lib/ai/agents/validation.ts` é importado por `AgentForm.tsx` ("use client")
 * — puxar `lib/integracoes/sistema-escolar.ts` aqui arrastaria `pg` para o
 * bundle do browser.
 */
export const SISTEMA_ESCOLAR_TOOL_IDS = [
  "consultar_aluno_sistema_escolar",
  "consultar_catalogo_cursos",
] as const;

export type SistemaEscolarToolId = (typeof SISTEMA_ESCOLAR_TOOL_IDS)[number];
