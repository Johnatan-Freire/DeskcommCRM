/**
 * Cron da importação do histórico do WhatsApp: avança UMA importação por
 * rodada, em lotes, até o orçamento de tempo. Agendado no `scheduler`
 * (`docker/scheduler/entrypoint.sh`).
 *
 * Não envia nada, por construção: as únicas portas são o leitor do WAHA (só
 * GET) e o recibo/`fn_importar_conversa_historica` — ver `lib/whatsapp-historico/`.
 * Sem importação pendente, a rodada não toca no WAHA nem audita.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { avancarImportacao } from "@/lib/whatsapp-historico/importador";
import { criarLeitorDeHistorico } from "@/lib/whatsapp-historico/leitor-waha";
import { criarRepositorioDaImportacao } from "@/lib/whatsapp-historico/repositorio";

export const dynamic = "force-dynamic";

/** Folga para o timeout de 60s do scheduler. */
const ORCAMENTO_MS = 40_000;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const url = process.env.WAHA_API_BASE_URL;
  const key = process.env.WAHA_API_KEY;
  if (!url || !key || key === "dev_plaintext_change_me") {
    return ok({ desfecho: "waha_nao_configurado" }, { requestId });
  }

  const admin = createAdminClient();
  try {
    const resumo = await avancarImportacao({
      repo: criarRepositorioDaImportacao(admin),
      leitor: criarLeitorDeHistorico({ baseUrl: url, apiKey: key }),
      orcamentoMs: ORCAMENTO_MS,
    });

    // Rodada que não importou nem mudou o recibo não é mutação e não audita.
    const houveEfeito =
      resumo.mensagensImportadas > 0 || resumo.desfecho === "concluida" || resumo.desfecho === "falhou";
    if (houveEfeito && resumo.importacaoId) {
      const { data } = await admin
        .from("whatsapp_history_imports" as never)
        .select("organization_id")
        .eq("id", resumo.importacaoId)
        .maybeSingle();
      void audit({
        action: "channel.history_import_progressed",
        organizationId: (data as { organization_id?: string } | null)?.organization_id ?? null,
        bypassedRls: true,
        resourceType: "whatsapp_history_import",
        resourceId: resumo.importacaoId,
        metadata: resumo as unknown as Record<string, unknown>,
        requestId,
      });
    }
    return ok(resumo, { requestId });
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    logger.error("[whatsapp-history-import] falhou", { error: detalhe, requestId });
    return fail("internal_error", "Failed to advance history import.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
