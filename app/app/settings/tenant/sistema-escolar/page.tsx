import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";
import { lerConfigSegura } from "@/lib/integracoes/sistema-escolar-config";
import { createAdminClient } from "@/lib/supabase/admin";

import { SistemaEscolarForm } from "./_components/SistemaEscolarForm";

export const dynamic = "force-dynamic";

/**
 * Fecha a dívida declarada em `docs/architecture/sistema-escolar.architecture.json`:
 * a configuração da integração só existia via provisionamento direto no banco.
 *
 * A tabela `org_sistema_escolar_config` tem `revoke select ... from authenticated,
 * anon` (migration 0399) — nenhum client de sessão a lê, nem com RLS a favor. Por
 * isso a leitura inicial acontece aqui, no Server Component, com o admin client
 * filtrando `organization_id` manualmente a partir do org resolvido por
 * `resolveActiveOrg` (nunca de query param ou body).
 */
export default async function SistemaEscolarConfigPage() {
  const user = await requireAuth();
  // `t` local em vez do hook: esta página é componente de SERVIDOR, e lá o
  // idioma vem resolvido em `user.idioma`.
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  // Ver é `manager` (mesma role da rota GET); editar é `admin` (mesma role do
  // PUT/DELETE) — a tela esconder os controles não é autorização, é cortesia.
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const podeEditar = user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  const config = await lerConfigSegura(createAdminClient(), activeOrg.orgId);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Sistema escolar")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "A URL e a chave da API do seu sistema escolar externo, que os agentes “Alunos” e “Interessados” consultam para matrícula, notas, frequência e catálogo de cursos. A chave é cifrada e nunca volta a aparecer na tela depois de salva.",
          )}
        </p>
      </header>
      <SistemaEscolarForm initialConfig={config} canWrite={podeEditar} />
    </div>
  );
}
