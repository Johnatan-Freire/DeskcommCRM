/**
 * Quem pode mudar a configuração da EMPRESA: o `admin` dela, ou quem administra a
 * plataforma fora de uma sessão de suporte.
 *
 * Fork Capital Code: o upstream decide o lado da plataforma por
 * `escreveComoPlatformAdmin` (escopo de platform admin), que não foi portado. Aqui a
 * régua é a que as telas do fork já usam: `is_platform_admin` sem `support`.
 */
import { ROLE_RANK, type ActiveOrg, type AuthUser } from "@/lib/auth/types";

export function podeAdministrarEmpresa(
  authUser: Pick<AuthUser, "is_platform_admin" | "support">,
  activeOrg: ActiveOrg,
): boolean {
  if (authUser.is_platform_admin && !authUser.support) return true;
  return ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
}
