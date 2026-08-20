/**
 * POST /api/v1/conversations/[id]/pause-bot
 *
 * O oposto de /reactivate-bot: um atendente pausa o atendimento automático
 * desta conversa NA HORA, sem precisar digitar uma mensagem (que só silencia
 * por 5min, deslizante — ver HUMAN_REPLY_SILENCE_MS em messages/_handler.ts)
 * nem esperar a própria IA decidir fazer handoff sozinha.
 *
 * Reusa `triggerHandoff` (lib/ai/handoff/orchestrator.ts) — o MESMO caminho
 * dos gatilhos automáticos G1-G4 (sentimento baixo, menção legal, etc.), só
 * com reason='manual_pause'. `bot_silenced_until='infinity'` sozinho já é
 * suficiente pro runtime (isLeadInHandoff, agent-engine) parar de responder;
 * não precisa duplicar a lógica.
 *
 * Auth: cookie session, role >= agent (mesma trava de reactivate-bot).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, contact_id, status")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (convErr) return fail("internal_error", convErr.message, 500, { requestId });
  if (!conv) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  if (conv.status === "closed" || conv.status === "archived") {
    return fail("state_conflict", "Conversa encerrada não pode ser pausada.", 409, { requestId });
  }

  // leadId é OPCIONAL pro handoff (timeline só grava se houver) — sem negócio
  // aberto não bloqueia a pausa, só fica sem entrada na timeline do CRM.
  let leadId: string | null = null;
  if (conv.contact_id) {
    const { data: leadsData } = await supabase
      .from("crm_leads")
      .select("id, organization_id, pipeline_id, status, last_activity_at, created_at")
      .eq("organization_id", activeOrg.orgId)
      .eq("contact_id", conv.contact_id);
    const { data: defaultPipeline } = await supabase
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_default", true)
      .eq("is_archived", false)
      .limit(1)
      .maybeSingle();
    const alvo = resolveActiveLeadForContact((leadsData ?? []) as LeadCandidate[], {
      defaultPipelineId: (defaultPipeline as { id: string } | null)?.id ?? null,
    });
    if (alvo.routed) leadId = alvo.leadId;
  }

  const resultado = await triggerHandoff({
    conversationId: id,
    organizationId: activeOrg.orgId,
    reason: "manual_pause",
    leadId,
  });

  if (!resultado.triggered && resultado.reason !== "idempotent_5s") {
    return fail("internal_error", "Não foi possível pausar o atendimento automático.", 500, {
      requestId,
    });
  }

  return ok({ paused: true }, { requestId });
}
