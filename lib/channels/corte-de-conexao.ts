/**
 * O corte de conexão (migration 0398): mensagem sincronizada pelo WAHA de
 * ANTES do pareamento não é gatilho de NADA que fale com o contato.
 *
 * WAHA/NOWEB (baileys) sincroniza histórico do WhatsApp ao parear um número
 * novo, e o mesmo webhook que entrega mensagem NOVA entrega a ANTIGA também,
 * sem nada que distinga as duas. `channel_sessions.first_connected_at` é
 * gravado uma única vez, por trigger, no instante em que a sessão ficou
 * WORKING pela primeira vez (`coalesce` protege de reconexão empurrar a
 * data). Mensagem com `sent_at` (horário REAL do WhatsApp) anterior a isso é
 * histórico sincronizado, não turno de atendimento.
 *
 * Sessão sem `first_connected_at` (já estava `WORKING` antes desta migration)
 * NUNCA é considerada histórica — comportamento idêntico ao de antes da
 * migration para quem já atende hoje sem problema nenhum.
 *
 * `lib/agent-engine/edge/crm/drain.ts` não usa este helper: consulta
 * `fn_ia_pode_responder_mensagem` (migration 0403), que aplica este mesmo
 * corte de conexão E o corte de ativação do agente. Todo outro consumidor de `message.received`/mensagem inbound que
 * possa causar um envio real ao contato usa este helper:
 * `workers/ai-response-worker.ts` (guard próprio, anterior a este arquivo),
 * `workers/ai-sentiment-worker.ts`, `lib/automation/engine.ts`,
 * `lib/followup/reactivity.ts`, `lib/followup/aplicar-inbound.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function mensagemAnteriorAConexao(
  admin: SupabaseClient,
  organizationId: string,
  messageId: string | null | undefined,
): Promise<boolean> {
  if (!messageId) return false;

  const { data: msg } = await admin
    .from("messages")
    .select("sent_at, channel_session_id")
    .eq("organization_id", organizationId)
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return false;

  const { data: sessao } = await admin
    .from("channel_sessions")
    .select("first_connected_at")
    .eq("organization_id", organizationId)
    .eq("id", msg.channel_session_id as string)
    .maybeSingle();
  if (!sessao?.first_connected_at) return false;

  return new Date(msg.sent_at as string).getTime() < new Date(sessao.first_connected_at).getTime();
}
