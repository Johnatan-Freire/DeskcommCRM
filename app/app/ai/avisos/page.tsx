import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { COLUNAS_DO_AVISO } from "@/lib/ai/avisos-temporarios";
import { AvisosClient, type AvisoLinha } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Avisos temporários (migration 0658): promoção com prazo, início de turma,
 * mudança temporária de horário. Os agentes só leem o que estiver PUBLICADO e
 * DENTRO do período — vencido sai do contexto sozinho.
 */
export default async function AvisosTemporariosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.agent) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  // Leitura no servidor, com o id da organização ATIVA da sessão.
  const admin = createAdminClient();
  const [{ data: avisos }, { data: agentes }] = await Promise.all([
    admin
      .from("avisos_temporarios")
      .select(COLUNAS_DO_AVISO)
      .eq("organization_id", activeOrg.orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("ai_agents")
      .select("id, name")
      .eq("organization_id", activeOrg.orgId)
      .is("archived_at", null)
      .order("name"),
  ]);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Avisos temporários")}</h1>
        <p className="text-sm text-text-muted">
          {t(
            "Promoções, início de turma e mudanças com prazo. Os agentes só usam o aviso publicado e dentro do período; depois do fim ele sai do atendimento sozinho.",
          )}
        </p>
      </header>
      <AvisosClient
        inicial={(avisos ?? []) as unknown as AvisoLinha[]}
        agentes={(agentes ?? []) as Array<{ id: string; name: string }>}
        podeEditar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager}
      />
    </div>
  );
}
