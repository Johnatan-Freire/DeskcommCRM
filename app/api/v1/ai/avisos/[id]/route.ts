import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * Um aviso temporário (migration 0658).
 *
 * GET   (agent+): o aviso e o histórico de alterações (quem, quando, o retrato).
 * PATCH (manager+): altera campos, publica ou arquiva. Não há DELETE: aviso sai
 *       do ar por `arquivado`, e o histórico fica.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { COLUNAS_DO_AVISO, editarAvisoSchema } from "@/lib/ai/avisos-temporarios";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("agent", { requestId, resource: "avisos_temporarios" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const admin = createAdminClient();
  const { data: aviso } = await admin
    .from("avisos_temporarios")
    .select(COLUNAS_DO_AVISO)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!aviso) return fail("not_found", t("Aviso não encontrado."), 404, { requestId });

  const { data: historico } = await admin
    .from("avisos_temporarios_historico")
    .select("operacao, autor_id, retrato, registrado_em")
    .eq("organization_id", authz.org.orgId)
    .eq("aviso_id", id)
    .order("registrado_em", { ascending: false })
    .limit(100);
  return ok({ aviso, historico: historico ?? [] }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("manager", { requestId, resource: "avisos_temporarios" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = editarAvisoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Aviso inválido."), 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();
  const { data: atual } = await admin
    .from("avisos_temporarios")
    .select("inicio_em, fim_em")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!atual) return fail("not_found", t("Aviso não encontrado."), 404, { requestId });

  const inicio = parsed.data.inicio_em ?? (atual as { inicio_em: string }).inicio_em;
  const fim = parsed.data.fim_em ?? (atual as { fim_em: string }).fim_em;
  if (!(new Date(fim) > new Date(inicio))) {
    return fail("validation_failed", t("O fim precisa ser depois do início."), 422, { requestId });
  }

  const { data, error } = await admin
    .from("avisos_temporarios")
    .update({ ...parsed.data, updated_by: authz.user.id })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS_DO_AVISO)
    .single();
  if (error || !data) return fail("internal_error", t("Erro ao salvar o aviso."), 500, { requestId });

  void audit({
    action: "ai.aviso_temporario_alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "avisos_temporarios",
    resourceId: id,
    requestId,
    metadata: { campos: Object.keys(parsed.data), status: parsed.data.status ?? null },
  });
  return ok(data, { requestId });
}
