import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { COLUNAS_DA_PRE_MATRICULA } from "@/lib/pre-matricula/registrar";
import { PreMatriculasClient, type PreMatriculaLinha } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Fila de pré-matrículas (migration 0659): quem pediu para se matricular pelo
 * WhatsApp, registrado pelo agente comercial com consentimento. A equipe assume,
 * conclui e anota; só ela marca "matriculado".
 */
export default async function PreMatriculasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.agent) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);
  const todas = (await searchParams).status === "todas";

  let q = createAdminClient()
    .from("pre_matriculas")
    .select(COLUNAS_DA_PRE_MATRICULA)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (!todas) q = q.in("status", ["nova", "em_atendimento"]);
  const { data } = await q;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Pré-matrículas")}</h1>
        <p className="text-sm text-text-muted">
          {t(
            "Pedidos de matrícula registrados pelo agente no WhatsApp, com a autorização da pessoa. A conversa já foi passada para a equipe; a matrícula só existe quando um consultor confirma.",
          )}
        </p>
      </header>
      <PreMatriculasClient inicial={(data ?? []) as unknown as PreMatriculaLinha[]} todas={todas} />
    </div>
  );
}
