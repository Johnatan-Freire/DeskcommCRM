/**
 * Importação do histórico do WhatsApp de UM número — Configurações › Canais.
 *
 * GET  lista os recibos do número (admin).
 * POST pede uma importação (admin): cria o recibo `pendente`, que o cron
 *      `whatsapp-history-import` avança. Esta rota não fala com o WAHA e não
 *      envia nada; quem importa só LÊ (ver lib/whatsapp-historico/).
 *
 * A organização vem da SESSÃO do admin (nunca do corpo), e o número tem de ser
 * dela. `Idempotency-Key` repetida devolve o mesmo recibo; um pedido com outra
 * importação viva no mesmo número devolve a viva (409).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { chaveDaRequisicao } from "@/lib/api/idempotency";
import { audit } from "@/lib/audit";
import { mfaEmDivida } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { COLUNAS_DO_RECIBO, janelaDoPedido, pedidoDeImportacaoSchema } from "@/lib/whatsapp-historico/pedido";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "whatsapp_history_imports" });
  if (!authz.ok) return authz.response;
  const { id } = await params;
  if (!UUID.test(id)) return fail("validation_failed", "Invalid id.", 422, { requestId });

  // Client do usuário: a RLS (só admin da organização) decide junto.
  const { data, error } = await (await createClient())
    .from("whatsapp_history_imports" as never)
    .select(COLUNAS_DO_RECIBO)
    .eq("organization_id", authz.org.orgId)
    .eq("channel_session_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "whatsapp_history_imports" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (await mfaEmDivida()) return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId });

  const { id } = await params;
  if (!UUID.test(id)) return fail("validation_failed", "Invalid id.", 422, { requestId });

  const chave = chaveDaRequisicao(req);
  if (chave !== null && !UUID.test(chave)) {
    return fail("validation_failed", "A chave de idempotência precisa ser um UUID.", 422, { requestId });
  }

  let bruto: unknown = {};
  try {
    bruto = await req.json();
  } catch {
    bruto = {};
  }
  const parsed = pedidoDeImportacaoSchema.safeParse(bruto ?? {});
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const org = authz.org.orgId;
  const admin = createAdminClient();
  const tabela = () => admin.from("whatsapp_history_imports" as never);

  if (chave) {
    const { data: repetido } = await tabela()
      .select(COLUNAS_DO_RECIBO)
      .eq("organization_id", org)
      .eq("idempotency_key", chave)
      .maybeSingle();
    if (repetido) return ok(repetido, { requestId });
  }

  const { data: sessao, error: erroSessao } = await admin
    .from("channel_sessions")
    .select("id, provider, first_connected_at")
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  if (erroSessao) return fail("internal_error", erroSessao.message, 500, { requestId });
  if (!sessao) return fail("not_found", t("Número não encontrado."), 404, { requestId });
  const linha = sessao as { provider: string | null; first_connected_at: string | null };
  if (linha.provider && linha.provider !== "waha") {
    return fail("unsupported", t("A importação do histórico só existe para números do WhatsApp conectados pelo QR."), 422, { requestId });
  }
  if (!linha.first_connected_at) {
    return fail(
      "sessao_sem_primeira_conexao",
      t("Este número ainda não foi conectado. O histórico é o que veio antes da primeira conexão."),
      409,
      { requestId },
    );
  }

  const janela = janelaDoPedido(new Date(linha.first_connected_at), parsed.data.janela_dias);
  const { data: criado, error } = await tabela()
    .insert({
      organization_id: org,
      channel_session_id: id,
      requested_by_user_id: authz.user.id,
      idempotency_key: chave,
      janela_inicio: janela.inicio.toISOString(),
      janela_fim: janela.fim.toISOString(),
      status: "pendente",
    } as never)
    .select(COLUNAS_DO_RECIBO)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      const { data: viva } = await tabela()
        .select(COLUNAS_DO_RECIBO)
        .eq("organization_id", org)
        .eq("channel_session_id", id)
        .in("status", ["pendente", "em_andamento"])
        .maybeSingle();
      return fail("importacao_ja_em_andamento", t("Já existe uma importação em andamento para este número."), 409, {
        requestId,
        details: { importacao: viva ?? null },
      });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const recibo = criado as { id: string } | null;
  void audit({
    action: "channel.history_import_requested",
    organizationId: org,
    actorUserId: authz.user.id,
    resourceType: "whatsapp_history_import",
    resourceId: recibo?.id ?? null,
    metadata: { channel_session_id: id, janela_dias: parsed.data.janela_dias },
    requestId,
  });
  return ok(criado, { requestId });
}
