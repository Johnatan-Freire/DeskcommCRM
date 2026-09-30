import type { Queryable } from "@/lib/agent-engine/queue/queue";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
export interface AgentOperationContext {
  organizationId: string;
  agentId: string;
  versionId: string;
  revision: string;
}
function assert(
  row:
    | {
        published_version_id: string | null;
        operation_revision: number | string;
        operation_mode: string;
        paused_at: string | null;
        archived_at: string | null;
      }
    | undefined
    | null,
  c: AgentOperationContext,
) {
  if (
    !row ||
    row.published_version_id !== c.versionId ||
    String(row.operation_revision) !== c.revision ||
    row.operation_mode !== "automatic" ||
    row.paused_at ||
    row.archived_at
  )
    throw new StaleServiceBoundaryError();
}
export async function assertAgentOperationPg(db: Queryable, c: AgentOperationContext) {
  const { rows } = await db.query<NonNullable<Parameters<typeof assert>[0]>>(
    "select published_version_id,operation_revision::text,operation_mode,paused_at,archived_at from ai_agents where organization_id=$1 and id=$2",
    [c.organizationId, c.agentId],
  );
  assert(rows[0], c);
}
export async function assertAgentOperationSupabase(db: SupabaseClient, c: AgentOperationContext) {
  const { data, error } = await db
    .from("ai_agents")
    .select("published_version_id,operation_revision,operation_mode,paused_at,archived_at")
    .eq("organization_id", c.organizationId)
    .eq("id", c.agentId)
    .maybeSingle();
  if (error) throw error;
  assert(data, c);
}

/**
 * O escopo do agente ainda serve à etapa do contato (migration 0404)? Relido no
 * `beforeSend`, o último instante antes do canal: o card pode ter mudado de etapa
 * enquanto o modelo gerava (identidade escolar, humano arrastando). Etapa terminal
 * ou só-humana, ou escopo diferente do que a etapa exige, derruba o envio com
 * `StaleServiceBoundaryError` — o mesmo desfecho de pausar o agente em voo.
 */
export async function assertEscopoDaEtapaSupabase(
  db: SupabaseClient,
  c: Pick<AgentOperationContext, "organizationId" | "versionId">,
  contactId: string | null | undefined,
) {
  if (!contactId) return;
  const { data: politica, error: erroPolitica } = await db.rpc(
    "fn_politica_de_atendimento_do_contato" as never,
    { p_org: c.organizationId, p_contact: contactId } as never,
  );
  if (erroPolitica) throw erroPolitica;
  if (politica === "terminal" || politica === "humano") throw new StaleServiceBoundaryError();
  const { data: versao, error: erroVersao } = await db
    .from("ai_agent_versions")
    .select("service_scope")
    .eq("organization_id", c.organizationId)
    .eq("id", c.versionId)
    .maybeSingle();
  if (erroVersao) throw erroVersao;
  const escopo = (versao as { service_scope?: string | null } | null)?.service_scope ?? "comercial";
  const exigido = politica === "academico" ? "academico" : "comercial";
  if (escopo !== exigido) throw new StaleServiceBoundaryError();
}
