"use server";

import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import {
  pipelineConfigPatchSchema,
  type PipelineConfigPatch,
} from "@/lib/schemas/settings";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export type UpdatePipelineConfigResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function updatePipelineConfig(
  pipelineId: string,
  patch: PipelineConfigPatch,
): Promise<UpdatePipelineConfigResult> {
  if (!pipelineId || typeof pipelineId !== "string") {
    return { ok: false, error: "invalid_request" };
  }
  const parsed = pipelineConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  const { data: row, error: readErr } = await supabase
    .from("crm_pipelines")
    .select("vocabulary, settings, organization_id")
    .eq("id", pipelineId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: "not_found" };
  if (row.organization_id !== activeOrg.orgId) {
    return { ok: false, error: "forbidden_tenant" };
  }

  const nextVocabulary = parsed.data.vocabulary
    ? { ...((row.vocabulary as Record<string, unknown> | null) ?? {}), ...parsed.data.vocabulary }
    : ((row.vocabulary as Record<string, unknown> | null) ?? {});

  const currentSettings = (row.settings as Record<string, unknown> | null) ?? {};
  const nextSettings: Record<string, unknown> = { ...currentSettings };
  if (parsed.data.fields !== undefined) nextSettings.fields = parsed.data.fields;
  if (parsed.data.lost_reasons !== undefined) nextSettings.lost_reasons = parsed.data.lost_reasons;
  if (parsed.data.won_reasons !== undefined) nextSettings.won_reasons = parsed.data.won_reasons;
  if (parsed.data.won_reason_required !== undefined) {
    nextSettings.won_reason_required = parsed.data.won_reason_required;
  }
  if (parsed.data.reabertura !== undefined) nextSettings.reabertura = parsed.data.reabertura;
  if (parsed.data.reabertura_campos !== undefined) {
    nextSettings.reabertura_campos = parsed.data.reabertura_campos;
  }
  // A entrada do Inbox (issue #3011): a ETAPA em que a conversa nova vira card
  // neste funil. Grava o bloco inteiro, e não campo a campo, porque `ativa` e
  // `stage_id` são uma decisão só — desligar sem perder a etapa escolhida é o
  // que a tela precisa poder fazer.
  if (parsed.data.entrada_do_inbox !== undefined) {
    nextSettings.entrada_do_inbox = parsed.data.entrada_do_inbox;
  }
  // #2995 — o recorte de encerrados antigos do quadro. `0` é um valor com
  // significado ("desliguei") e por isso a chave é gravada como veio: pular o
  // zero deixaria o número antigo no banco e o quadro seguiria escondendo card
  // de quem acabou de desligar a opção.
  if (parsed.data.ocultar_encerrados_dias !== undefined) {
    nextSettings.ocultar_encerrados_dias = parsed.data.ocultar_encerrados_dias;
  }

  const { error } = await supabase
    .from("crm_pipelines")
    .update({ vocabulary: nextVocabulary, settings: nextSettings })
    .eq("id", pipelineId);
  if (error) return { ok: false, error: error.message };

  await audit({
    action: "pipeline.config_updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: {
      vocabulary_changed: !!parsed.data.vocabulary,
      fields_count: parsed.data.fields?.length ?? null,
      lost_reasons_count: parsed.data.lost_reasons?.length ?? null,
      won_reasons_count: parsed.data.won_reasons?.length ?? null,
      won_reason_required: parsed.data.won_reason_required ?? null,
      reabertura: parsed.data.reabertura ?? null,
      entrada_do_inbox_ativa: parsed.data.entrada_do_inbox?.ativa ?? null,
      // #2995: quantos cards o quadro deixa de mostrar é decisão de quem opera
      // — a auditoria registra o número (ou `0`, o desligamento).
      ocultar_encerrados_dias: parsed.data.ocultar_encerrados_dias ?? null,
    },
  });

  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}
