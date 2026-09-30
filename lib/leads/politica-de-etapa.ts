/**
 * O vocabulário da política de atendimento por etapa (migration 0404).
 *
 * A DECISÃO não mora aqui — mora em SQL (`fn_ia_pode_responder_mensagem`,
 * `fn_silencio_pode_reengajar`, `fn_followup_pode_enviar`) e no gatilho
 * `trg_crm_leads_trava_de_saida`, porque os dois transportes do produto (pg do
 * agent-engine e client Supabase) precisam da mesma resposta. Este arquivo só dá
 * nome às quatro políticas e aos dois escopos de agente, com o CHECK do banco
 * como fonte: um valor fora destas listas é recusado lá também.
 */

/** `crm_stages.service_policy` — CHECK `crm_stages_service_policy_valida`. */
export const POLITICAS_DE_ETAPA = ["comercial", "terminal", "humano", "academico"] as const;
export type PoliticaDeEtapa = (typeof POLITICAS_DE_ETAPA)[number];

/** `ai_agent_versions.service_scope` — CHECK `ai_agent_versions_service_scope_valido`. */
export const ESCOPOS_DE_AGENTE = ["comercial", "academico"] as const;
export type EscopoDeAgente = (typeof ESCOPOS_DE_AGENTE)[number];

/** SQLSTATE do gatilho da trava de saída. */
export const SQLSTATE_ETAPA_TRAVADA = "PT423";

/** Frase de tela para a recusa da trava — a mesma em todo escritor. */
export const FRASE_ETAPA_TRAVADA =
  "Este contato está numa etapa permanente e não pode ser movido para outra etapa do funil.";

/** O erro veio do gatilho da trava de saída? (Postgres via pg, ou PostgREST). */
export function ehRecusaDeEtapaTravada(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as { code?: unknown; message?: unknown };
  return e.code === SQLSTATE_ETAPA_TRAVADA || (typeof e.message === "string" && e.message.includes("etapa_travada"));
}

/**
 * Etapa só-humana ou acadêmica não pode ser desfecho comercial — mesma regra do
 * CHECK `crm_stages_politica_sem_desfecho`, dita para a tela antes do banco.
 */
export function politicaAceitaDesfecho(politica: string | null | undefined): boolean {
  return politica !== "humano" && politica !== "academico";
}
