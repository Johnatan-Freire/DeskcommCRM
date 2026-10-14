import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH /api/v1/pre-matriculas/:id (agent+) — a equipe dá andamento: assume
 * (`em_atendimento`, grava quem), conclui (`matriculado` | `desistiu`) ou anota.
 * Só a equipe marca `matriculado` — a IA nunca confirma matrícula.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { alterarPreMatriculaSchema, COLUNAS_DA_PRE_MATRICULA } from "@/lib/pre-matricula/registrar";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("agent", { requestId, resource: "pre_matriculas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = alterarPreMatriculaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Alteração inválida."), 422, { requestId, details: parsed.error.flatten() });
  }

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "em_atendimento") patch.atendida_por = authz.user.id;

  const { data, error } = await createAdminClient()
    .from("pre_matriculas")
    .update(patch)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS_DA_PRE_MATRICULA)
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao salvar a pré-matrícula."), 500, { requestId });
  if (!data) return fail("not_found", t("Pré-matrícula não encontrada."), 404, { requestId });

  void audit({
    action: "pre_matricula.alterada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "pre_matriculas",
    resourceId: id,
    requestId,
    metadata: { status: parsed.data.status ?? null, observacao_alterada: parsed.data.observacao !== undefined },
  });
  return ok(data, { requestId });
}
