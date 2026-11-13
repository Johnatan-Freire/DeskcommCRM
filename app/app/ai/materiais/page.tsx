import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_DOS_MATERIAIS, COLUNAS_DO_MATERIAL } from "@/lib/ai/materiais-do-agente";
import { MateriaisClient, type MaterialLinha } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Materiais do agente (migration 8006): vídeos, imagens e PDFs que os agentes
 * de IA enviam na conversa, cada um com a situação em que deve ir.
 */
export default async function MateriaisDoAgentePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.agent) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  // Leitura no servidor, com o id da organização ATIVA da sessão.
  const admin = createAdminClient();
  const [{ data: materiais }, { data: agentes }] = await Promise.all([
    admin
      .from("materiais_do_agente")
      .select(`${COLUNAS_DO_MATERIAL}, storage_path`)
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

  // URL assinada curta para a prévia na tela: o bucket é privado.
  const linhas = (materiais ?? []) as unknown as Array<MaterialLinha & { storage_path: string }>;
  const caminhos = linhas.map((m) => m.storage_path);
  const { data: assinadas } =
    caminhos.length > 0
      ? await admin.storage.from(BUCKET_DOS_MATERIAIS).createSignedUrls(caminhos, 3600)
      : { data: [] as Array<{ path: string | null; signedUrl: string }> };
  const urlPorCaminho = new Map((assinadas ?? []).map((a) => [a.path, a.signedUrl]));
  const inicial: MaterialLinha[] = linhas.map(({ storage_path, ...m }) => ({
    ...m,
    url: urlPorCaminho.get(storage_path) ?? null,
  }));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Materiais do agente")}</h1>
        <p className="text-sm text-text-muted">
          {t(
            "Vídeos, imagens e PDFs que os agentes de IA enviam na conversa. Para cada um, escreva em que situação ele deve ser enviado: o agente lê essa instrução e decide pelo contexto, e não manda o mesmo material duas vezes na mesma conversa.",
          )}
        </p>
      </header>
      <MateriaisClient
        inicial={inicial}
        agentes={(agentes ?? []) as Array<{ id: string; name: string }>}
        podeEditar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager}
      />
    </div>
  );
}
