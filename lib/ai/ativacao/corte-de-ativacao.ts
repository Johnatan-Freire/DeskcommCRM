/**
 * O corte temporal de ATIVAÇÃO (migration 0403): a IA só atende mensagem que
 * aconteceu DEPOIS de ter sido ligada — publicação, despausa ou troca de modo.
 *
 * A decisão NÃO mora aqui: mora em SQL (`fn_ia_pode_responder_mensagem`,
 * `fn_silencio_pode_reengajar`, `fn_followup_pode_enviar`), porque os dois
 * transportes do produto precisam dela — o `pg.Pool` do agent-engine (drain,
 * turno, followup_turn) e o client Supabase (sweep de silêncio, envio inline do
 * follow-up). Duas cópias da regra em TypeScript seriam duas respostas para a
 * mesma pergunta; este arquivo só tipa o motivo e chama a função.
 *
 * Fonte do horário: `ai_agents.service_enabled_at`, gravada SÓ por trigger.
 * Mensagem é comparada pelo `sent_at` (horário REAL do WhatsApp), nunca pelo
 * `created_at` da linha — histórico importado depois da ativação continua
 * sendo histórico.
 *
 * Fail-closed em toda ponta: a função devolve motivo ≠ 'autorizado' quando não
 * dá para afirmar que a mensagem é nova; e erro de leitura LANÇA (o chamador
 * não despacha — o job/evento re-tenta). Nunca há "na dúvida, responde".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Queryable } from "@/lib/agent-engine/queue/queue";

export const AUTORIZADO = "autorizado";

/** Motivos de `fn_ia_pode_responder_mensagem`. */
export type MotivoDoCorteDeMensagem =
  | typeof AUTORIZADO
  | "mensagem_desconhecida"
  | "nao_e_mensagem_do_contato"
  | "horario_desconhecido"
  | "horario_ambiguo"
  | "anterior_a_conexao"
  | "agente_fora_do_ar"
  | "ativacao_desconhecida"
  | "anterior_a_ativacao"
  | "nenhum_agente_no_ar";

/** Motivos de `fn_silencio_pode_reengajar` (inclui os do corte de mensagem). */
export type MotivoDoSilencio =
  | MotivoDoCorteDeMensagem
  | "conversa_desconhecida"
  | "grupo"
  | "conversa_encerrada"
  | "contato_bloqueado"
  | "humano_atendendo"
  | "conversa_sem_mensagens"
  | "contato_aguardando_resposta"
  | "humano_falou_por_ultimo"
  | "contato_nunca_falou"
  | "ja_reengajado_neste_silencio";

/** Motivos de `fn_followup_pode_enviar`. */
export type MotivoDoEnvioDeFollowup = MotivoDoSilencio | "inscricao_desconhecida" | "fluxo_desligado";

async function umaLinha<T>(db: Queryable, sql: string, params: unknown[]): Promise<T> {
  const { rows } = await db.query<{ motivo: T }>(sql, params);
  const motivo = rows[0]?.motivo;
  // Resposta vazia não é "autorizado": sem a palavra da função, não dispara.
  if (motivo == null) throw new Error("corte_de_ativacao_sem_resposta");
  return motivo;
}

async function viaRpc<T>(
  admin: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  if (typeof data !== "string") throw new Error("corte_de_ativacao_sem_resposta");
  return data as T;
}

/**
 * A mensagem pode disparar a IA? `agentId` = o agente que VAI responder (turno);
 * `null` = qualquer agente no ar que atenda o número (drain, antes do roteador).
 */
export function iaPodeResponderMensagem(
  db: Queryable,
  organizationId: string,
  messageId: string,
  agentId: string | null,
): Promise<MotivoDoCorteDeMensagem> {
  return umaLinha(db, "select public.fn_ia_pode_responder_mensagem($1, $2, $3) as motivo", [
    organizationId,
    messageId,
    agentId,
  ]);
}

/** Mesma pergunta de `iaPodeResponderMensagem`, pelo client Supabase (workers do app). */
export function iaPodeResponderMensagemViaSupabase(
  admin: SupabaseClient,
  organizationId: string,
  messageId: string,
  agentId: string | null,
): Promise<MotivoDoCorteDeMensagem> {
  return viaRpc(admin, "fn_ia_pode_responder_mensagem", {
    p_org: organizationId,
    p_message: messageId,
    p_agent: agentId,
  });
}

/** O silêncio desta conversa pode virar um reengajamento automático? */
export function silencioPodeReengajarViaSupabase(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  paraInscrever: boolean,
): Promise<MotivoDoSilencio> {
  return viaRpc(admin, "fn_silencio_pode_reengajar", {
    p_org: organizationId,
    p_conversation: conversationId,
    p_para_inscrever: paraInscrever,
  });
}

/** Esta inscrição de follow-up pode enviar AGORA? */
export function followupPodeEnviar(
  db: Queryable,
  organizationId: string,
  enrollmentId: string,
): Promise<MotivoDoEnvioDeFollowup> {
  return umaLinha(db, "select public.fn_followup_pode_enviar($1, $2) as motivo", [
    organizationId,
    enrollmentId,
  ]);
}

export function followupPodeEnviarViaSupabase(
  admin: SupabaseClient,
  organizationId: string,
  enrollmentId: string,
): Promise<MotivoDoEnvioDeFollowup> {
  return viaRpc(admin, "fn_followup_pode_enviar", {
    p_org: organizationId,
    p_enrollment: enrollmentId,
  });
}

/** Texto legível do motivo — o que vai para o enrollment e para o log. */
export function explicarCorte(motivo: string): string {
  const textos: Record<string, string> = {
    anterior_a_ativacao: "a mensagem é de antes de o agente ser ligado (publicação ou despausa)",
    anterior_a_conexao: "a mensagem é de antes de o WhatsApp ser conectado",
    agente_fora_do_ar: "o agente está pausado, despublicado ou arquivado",
    nenhum_agente_no_ar: "nenhum agente está no ar para este número",
    ativacao_desconhecida: "não se sabe desde quando o agente está no ar",
    horario_desconhecido: "a mensagem não tem horário real",
    horario_ambiguo: "o horário da mensagem está no futuro",
    humano_atendendo: "um humano está atendendo a conversa",
    humano_falou_por_ultimo: "quem falou por último foi um humano",
    contato_aguardando_resposta: "o contato falou por último e está esperando resposta",
    conversa_encerrada: "a conversa está encerrada",
    fluxo_desligado: "o fluxo de follow-up foi desligado",
    ja_reengajado_neste_silencio: "este silêncio já recebeu um reengajamento",
  };
  return textos[motivo] ?? motivo;
}
