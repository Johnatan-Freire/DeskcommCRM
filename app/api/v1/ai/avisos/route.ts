import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * Avisos temporários dos agentes de IA (migration 0658).
 *
 * GET  (agent+): todos os avisos da organização, do mais recente ao mais antigo.
 * POST (manager+): cria um aviso. O prazo é obrigatório e o fim tem de ser depois
 *      do início — aviso sem fim é exatamente o que a Memória da Org já é.
 *
 * Toda criação e alteração também vira linha no histórico (gatilho no banco).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { COLUNAS_DO_AVISO, criarAvisoSchema } from "@/lib/ai/avisos-temporarios";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "avisos_temporarios" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { data, error } = await createAdminClient()
    .from("avisos_temporarios")
    .select(COLUNAS_DO_AVISO)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return fail("internal_error", t("Erro ao carregar os avisos."), 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "avisos_temporarios" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = criarAvisoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Aviso inválido."), 422, { requestId, details: parsed.error.flatten() });
  }

  const { data, error } = await createAdminClient()
    .from("avisos_temporarios")
    .insert({
      ...parsed.data,
      organization_id: authz.org.orgId,
      created_by: authz.user.id,
      updated_by: authz.user.id,
    })
    .select(COLUNAS_DO_AVISO)
    .single();
  if (error || !data) return fail("internal_error", t("Erro ao salvar o aviso."), 500, { requestId });

  void audit({
    action: "ai.aviso_temporario_criado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "avisos_temporarios",
    resourceId: (data as { id: string }).id,
    requestId,
    metadata: { status: parsed.data.status, fim_em: parsed.data.fim_em, publico: parsed.data.publico },
  });
  return ok(data, { requestId });
}
