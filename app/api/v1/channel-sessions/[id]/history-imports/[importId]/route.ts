/**
 * DELETE cancela uma importação de histórico viva (admin). O que já foi
 * importado fica — é dado, e a mensagem histórica não dispara nada. O cron vê
 * o cancelamento na próxima página: o banco recusa lote de importação que não
 * está em andamento.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { mfaEmDivida } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { COLUNAS_DO_RECIBO } from "@/lib/channels/historico/pedido";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; importId: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "whatsapp_history_imports" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (await mfaEmDivida()) return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId });

  const { id, importId } = await params;
  if (!UUID.test(id) || !UUID.test(importId)) return fail("validation_failed", "Invalid id.", 422, { requestId });

  const { data, error } = await createAdminClient()
    .from("whatsapp_history_imports" as never)
    .update({ status: "cancelada", finished_at: new Date().toISOString() } as never)
    .eq("organization_id", authz.org.orgId)
    .eq("channel_session_id", id)
    .eq("id", importId)
    .in("status", ["pendente", "em_andamento"])
    .select(COLUNAS_DO_RECIBO)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", t("Não há importação em andamento com este id."), 404, { requestId });

  void audit({
    action: "channel.history_import_cancelled",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "whatsapp_history_import",
    resourceId: importId,
    metadata: { channel_session_id: id },
    requestId,
  });
  return ok(data, { requestId });
}
