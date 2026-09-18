/**
 * GET    /api/v1/settings/sistema-escolar — estado atual da integração (manager+).
 *                                            Nunca devolve a chave — só `api_key_last4`.
 * PUT    /api/v1/settings/sistema-escolar — cria/atualiza (admin). Chave em claro
 *                                            entra só aqui, cifrada e descartada.
 * DELETE /api/v1/settings/sistema-escolar — remove a integração da organização (admin).
 *
 * A tabela nasceu com `revoke select ... from authenticated, anon` (migration
 * 0169) — nenhum caminho de browser lê `api_key_encrypted/iv/tag` nem aqui: as
 * três funções usadas (`lerConfigSegura`, `salvarConfig`, `removerConfig`) só
 * selecionam colunas seguras ou nunca devolvem a linha. `organization_id` vem
 * sempre do cookie validado por `requireRole`, nunca do body.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  lerConfigSegura,
  salvarConfig,
  removerConfig,
  testarConexao,
} from "@/lib/integracoes/sistema-escolar-config";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  base_url: z.string().trim().url().max(300),
  // Vazio/ausente = "não mexi na chave" (ver salvarConfig). Só é exigido na
  // primeira criação, checado depois de saber se já existe linha.
  api_key: z.string().trim().min(1).max(500).optional(),
  is_active: z.boolean(),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "org_sistema_escolar_config" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const config = await lerConfigSegura(createAdminClient(), activeOrg.orgId);
  return ok(config, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "org_sistema_escolar_config" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }

  const parsed = putSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;
  const baseUrl = input.base_url.replace(/\/$/, "");
  const admin = createAdminClient();

  const salvo = await salvarConfig(admin, activeOrg.orgId, authUser.id, {
    baseUrl,
    apiKey: input.api_key,
    isActive: input.is_active,
  });
  if (!salvo.ok) {
    return fail(
      "chave_obrigatoria_na_criacao",
      "Informe a chave de API — esta organização ainda não tem uma cadastrada.",
      422,
      { requestId },
    );
  }

  const config = await lerConfigSegura(admin, activeOrg.orgId);

  // Best-effort: a chave já foi salva (o operador não precisa refazer nada se
  // a rede do sistema escolar estiver instável agora), mas o teste fecha o
  // laço de retorno na hora, em vez de só quando um aluno perguntar algo.
  const teste = config.is_active
    ? await testarConexao(admin, activeOrg.orgId)
    : { ok: true as const };

  await audit({
    action: "sistema_escolar.config_salva",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "org_sistema_escolar_config",
    resourceId: activeOrg.orgId,
    requestId,
    metadata: { base_url: baseUrl, is_active: input.is_active, teste_de_conexao_ok: teste.ok },
  });

  return ok({ config, teste_de_conexao: teste }, { requestId });
}

export async function DELETE(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "org_sistema_escolar_config" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  await removerConfig(createAdminClient(), activeOrg.orgId);

  await audit({
    action: "sistema_escolar.config_removida",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "org_sistema_escolar_config",
    resourceId: activeOrg.orgId,
    requestId,
  });

  return ok({ deleted: true }, { requestId });
}
