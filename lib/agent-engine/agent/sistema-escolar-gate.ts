import { SISTEMA_ESCOLAR_TOOL_IDS } from "@/lib/integracoes/sistema-escolar-tools";

/**
 * Quais das duas tools de sistema escolar entram no turno.
 *
 * Duas condições EM SÉRIE: a org tem a integração configurada e ativa
 * (org-wide, `org_sistema_escolar_config`) E o agente publicado marcou aquela
 * tool especificamente na tela (por-agente, `ai_agent_versions.sistema_escolar_tool_ids`).
 * Sem a primeira, nenhum self-host que não é a Capital Code vê estas tools no
 * prompt. Sem a segunda, um agente de vendas ("Interessados") não puxa nota de
 * aluno matriculado só porque sabe o telefone, e um agente de suporte
 * ("Alunos") não cota preço de curso — o gap medido antes desta função existir.
 *
 * `agentToolIds: null` é o turno SEM agente publicado (fallback de playbook —
 * `resolveTurnAgent` devolve `null` quando não há versão publicada para a
 * channel_session). Não há ONDE a org marcar "só uma das duas" nesse caminho,
 * então ele preserva o comportamento anterior a este escopo: as duas tools
 * entram juntas sempre que a org tem config ativa.
 */
export function toolsDoSistemaEscolarNoTurno(input: {
  orgConfigurada: boolean;
  agentToolIds: readonly string[] | null;
}): { aluno: boolean; catalogo: boolean } {
  if (!input.orgConfigurada) return { aluno: false, catalogo: false };
  if (input.agentToolIds === null) return { aluno: true, catalogo: true };
  const ligadas = new Set(input.agentToolIds);
  return {
    aluno: ligadas.has(SISTEMA_ESCOLAR_TOOL_IDS[0]),
    catalogo: ligadas.has(SISTEMA_ESCOLAR_TOOL_IDS[1]),
  };
}
