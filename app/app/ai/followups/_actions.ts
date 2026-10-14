"use server";

/**
 * Pausa GLOBAL de follow-ups da organização (migration 0657; auditoria de
 * agentes, 14/10/2026). O efeito mora no banco — o claim não reivindica
 * organização pausada, inscrição nova nasce cancelada e as funções de corte
 * respondem `followups_pausados` —; aqui só se grava a chave e quem a mexeu.
 *
 * Pausar é ato de SEGURANÇA: manager+ pode. Retomar devolve envios automáticos
 * aos clientes: só admin.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: true } | { ok: false; error: string; message?: string };

async function guarda(minimo: Role) {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false as const, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false as const, error: "forbidden_tenant" };
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK[minimo]) return { ok: false as const, error: "forbidden_role" };
  return { ok: true as const, authUser, orgId: activeOrg.orgId };
}

export async function pausarTodosOsFollowupsAction(): Promise<ActionResult> {
  const g = await guarda("manager");
  if (!g.ok) return g;
  const { error } = await createAdminClient()
    .from("organizations")
    .update({ followups_pausados_em: new Date().toISOString(), followups_pausados_por: g.authUser.id })
    .eq("id", g.orgId)
    .is("followups_pausados_em", null);
  if (error) return { ok: false, error: "internal_error", message: error.message };
  void audit({
    action: "followups.paused_all",
    actorUserId: g.authUser.id,
    organizationId: g.orgId,
    resourceType: "organization",
    resourceId: g.orgId,
    requestId: randomUUID(),
    metadata: {},
  });
  revalidatePath("/app/ai/followups");
  return { ok: true };
}

export async function retomarTodosOsFollowupsAction(): Promise<ActionResult> {
  const g = await guarda("admin");
  if (!g.ok) return g;
  const { error } = await createAdminClient()
    .from("organizations")
    .update({ followups_pausados_em: null, followups_pausados_por: null })
    .eq("id", g.orgId);
  if (error) return { ok: false, error: "internal_error", message: error.message };
  void audit({
    action: "followups.resumed_all",
    actorUserId: g.authUser.id,
    organizationId: g.orgId,
    resourceType: "organization",
    resourceId: g.orgId,
    requestId: randomUUID(),
    metadata: {},
  });
  revalidatePath("/app/ai/followups");
  return { ok: true };
}
