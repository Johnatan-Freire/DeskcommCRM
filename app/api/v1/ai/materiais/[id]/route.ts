import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * Um material do agente (migration 8006).
 *
 * PATCH  (manager+): título, "quando enviar", agentes e ativo. O arquivo não
 *        muda: trocar o arquivo é cadastrar outro material.
 * DELETE (manager+): apaga o cadastro e o arquivo do bucket. As cópias que já
 *        saíram nas conversas ficam com as conversas.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_DOS_MATERIAIS, COLUNAS_DO_MATERIAL, editarMaterialSchema } from "@/lib/ai/materiais-do-agente";
import { agentesSaoDaOrganizacao } from "@/lib/ai/materiais-do-agente-servidor";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "materiais_do_agente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return fail("not_found", t("Material não encontrado."), 404, { requestId });
  const materialId = id.data;
  const parsed = editarMaterialSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Material inválido."), 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();
  if (parsed.data.agente_ids && !(await agentesSaoDaOrganizacao(admin, authz.org.orgId, parsed.data.agente_ids))) {
    return fail("validation_failed", t("Algum agente escolhido não é desta organização."), 422, { requestId });
  }

  const { data, error } = await admin
    .from("materiais_do_agente")
    .update({ ...parsed.data, updated_by: authz.user.id })
    .eq("organization_id", authz.org.orgId)
    .eq("id", materialId)
    .select(COLUNAS_DO_MATERIAL)
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao salvar o material."), 500, { requestId });
  if (!data) return fail("not_found", t("Material não encontrado."), 404, { requestId });

  void audit({
    action: "ai.material_do_agente_alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "materiais_do_agente",
    resourceId: materialId,
    requestId,
    metadata: { campos: Object.keys(parsed.data) },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "materiais_do_agente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return fail("not_found", t("Material não encontrado."), 404, { requestId });
  const materialId = id.data;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("materiais_do_agente")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", materialId)
    .select("storage_path")
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao remover o material."), 500, { requestId });
  if (!data) return fail("not_found", t("Material não encontrado."), 404, { requestId });

  // O cadastro já saiu: um arquivo que não sair do bucket fica órfão, mas o
  // agente não o alcança mais. Não desfaz a remoção por isso.
  await admin.storage.from(BUCKET_DOS_MATERIAIS).remove([(data as { storage_path: string }).storage_path]);

  void audit({
    action: "ai.material_do_agente_removido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "materiais_do_agente",
    resourceId: materialId,
    requestId,
  });
  return ok({ id: materialId }, { requestId });
}
