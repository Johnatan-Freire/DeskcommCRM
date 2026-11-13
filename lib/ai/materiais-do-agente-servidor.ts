/**
 * Conferências de servidor dos materiais do agente (8006), separadas de
 * `materiais-do-agente.ts` para que a tela possa importar aquele sem puxar o
 * cliente do Supabase.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Todos os agentes escolhidos existem NESTA organização. O cliente é service
 * role (ignora RLS): sem esta conferência, um id de agente de outra organização
 * entraria em `agente_ids` e nunca casaria com nada — ou casaria, se um dia o id
 * fosse reaproveitado. Lista vazia (= todos os agentes) passa.
 */
export async function agentesSaoDaOrganizacao(
  admin: Admin,
  organizationId: string,
  agenteIds: readonly string[],
): Promise<boolean> {
  const unicos = [...new Set(agenteIds)];
  if (unicos.length === 0) return true;
  const { data, error } = await admin
    .from("ai_agents")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", unicos);
  if (error) return false;
  return (data ?? []).length === unicos.length;
}
