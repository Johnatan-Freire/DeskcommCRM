/**
 * GET /api/v1/pre-matriculas (agent+) — a fila de pré-matrículas da organização
 * (migration 0659). `?status=abertas` (padrão) traz nova + em_atendimento;
 * `?status=todas` traz tudo. Escrita de pré-matrícula nova é do agente (motor),
 * não desta rota.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { COLUNAS_DA_PRE_MATRICULA } from "@/lib/pre-matricula/registrar";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "pre_matriculas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const filtro = req.nextUrl.searchParams.get("status") === "todas" ? "todas" : "abertas";
  let q = createAdminClient()
    .from("pre_matriculas")
    .select(COLUNAS_DA_PRE_MATRICULA)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (filtro === "abertas") q = q.in("status", ["nova", "em_atendimento"]);
  const { data, error } = await q;
  if (error) return fail("internal_error", t("Erro ao carregar as pré-matrículas."), 500, { requestId });
  return ok(data ?? [], { requestId });
}
