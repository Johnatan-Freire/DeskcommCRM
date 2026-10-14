import { requireSupportWrite } from "@/lib/impersonate/support";
/** DELETE /api/v1/attendants/feriados/:id (manager+) — remove um dia do calendário (0660). */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("manager", { requestId, resource: "feriados_de_atendimento" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { data, error } = await createAdminClient()
    .from("feriados_de_atendimento")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select("data")
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao remover o feriado."), 500, { requestId });
  if (!data) return fail("not_found", t("Feriado não encontrado."), 404, { requestId });

  void audit({
    action: "atendimento.feriado_removido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "feriados_de_atendimento",
    resourceId: id,
    requestId,
    metadata: { data: (data as { data: string }).data },
  });
  return ok({ removido: true }, { requestId });
}
