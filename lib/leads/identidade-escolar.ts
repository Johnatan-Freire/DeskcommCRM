/**
 * IDENTIDADE ESCOLAR DO CONTATO — o telefone está relacionado a um aluno?
 *
 * ## A régua, e por que é estreita
 *
 * Só `relacionado_a_aluno` ou `desconhecido`. Nunca "é o aluno", "é a mãe", "é o
 * responsável": o Sistema Escolar devolve o campo do cadastro que casou
 * (`numero_contato`, `numero_contato2`), e isso diz ONDE o número está escrito,
 * não QUEM é a pessoa. Um pai com dois filhos, uma avó que busca o neto e o
 * próprio aluno maior de idade caem todos no mesmo lugar — e é o agente acadêmico,
 * depois, que desambigua pedindo o nome completo.
 *
 * `relacionado_a_aluno` exige as TRÊS coisas: a API achou alguém, afirmou casamento
 * pelo número COMPLETO (`match_type === 'exact'`) e devolveu pelo menos um aluno.
 * Qualquer outra resposta — API antiga sem `match_type` (casava pelo sufixo: um
 * aluno de outro DDD), casamento não exato, erro, timeout, payload inválido — é
 * `desconhecido`. Fail-closed: errar para "desconhecido" deixa o contato no fluxo
 * comercial, sem dado acadêmico; errar para "relacionado" o prenderia para sempre
 * numa etapa travada (`exit_locked`) com dados de aluno ao alcance.
 *
 * ## O movimento
 *
 * Relacionado → o card do lead ABERTO vai para a etapa de política `academico` do
 * mesmo funil, se existir. A etapa é achada pela POLÍTICA, não pelo nome: renomear
 * a coluna não desliga nada. Com `exit_locked` nessa etapa, é um caminho de mão
 * única — e é isso que o dono pediu (2026-09-30).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RespostaAlunoPorTelefone } from "@/lib/integracoes/sistema-escolar";
import { emitLeadActivity, stageChangeReason } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { ehRecusaDeEtapaTravada } from "@/lib/leads/politica-de-etapa";
import { logger } from "@/lib/logger";

export type IdentidadeEscolar = "relacionado_a_aluno" | "desconhecido";

/** A decisão, pura. `null` = a consulta falhou (erro, timeout, payload inválido). */
export function decidirIdentidadeEscolar(resposta: RespostaAlunoPorTelefone | null): IdentidadeEscolar {
  if (resposta === null) return "desconhecido";
  if (!resposta.encontrado) return "desconhecido";
  if (resposta.match_type !== "exact") return "desconhecido";
  if (!Array.isArray(resposta.alunos) || resposta.alunos.length === 0) return "desconhecido";
  return "relacionado_a_aluno";
}

export interface ResultadoDaEtapaAcademica {
  moveu: boolean;
  motivo:
    | "movido"
    | "ja_esta_la"
    | "sem_lead_aberto"
    | "sem_etapa_academica"
    | "etapa_travada"
    | "conflito_humano"
    | "falha_de_escrita"
    | "indisponivel";
  leadId?: string;
}

/**
 * Leva o card do lead aberto do contato para a etapa acadêmica do funil dele.
 *
 * Contato com mais de um lead aberto: move o mais recente que tem etapa acadêmica
 * no funil — a identidade é do CONTATO, e "aluno num funil, lead comercial no
 * outro" não é estado que esta regra crie.
 */
export async function moverContatoParaEtapaAcademica(
  admin: SupabaseClient,
  input: { organizationId: string; contactId: string },
): Promise<ResultadoDaEtapaAcademica> {
  const { data: leads, error: erroLeads } = await admin
    .from("crm_leads")
    .select("id, pipeline_id, stage_id, contact_id, status, created_at")
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (erroLeads) return { moveu: false, motivo: "indisponivel" };
  const abertos = (leads ?? []) as Array<{ id: string; pipeline_id: string; stage_id: string; status: string }>;
  if (abertos.length === 0) return { moveu: false, motivo: "sem_lead_aberto" };

  for (const lead of abertos) {
    const { data: etapa, error: erroEtapa } = await admin
      .from("crm_stages")
      .select("id, name")
      .eq("organization_id", input.organizationId)
      .eq("pipeline_id", lead.pipeline_id)
      .eq("service_policy", "academico")
      .eq("is_archived", false)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (erroEtapa) return { moveu: false, motivo: "indisponivel", leadId: lead.id };
    if (!etapa) continue;
    const destino = etapa as { id: string; name: string };
    if (lead.stage_id === destino.id) return { moveu: false, motivo: "ja_esta_la", leadId: lead.id };

    const { data: origem } = await admin.from("crm_stages").select("name").eq("id", lead.stage_id).maybeSingle();
    const { data: atualizadas, error: erroUpdate } = await admin
      .from("crm_leads")
      .update({ stage_id: destino.id })
      .eq("id", lead.id)
      .eq("organization_id", input.organizationId)
      // Trava otimista pela origem: humano que moveu o card no meio-tempo vence.
      .eq("stage_id", lead.stage_id)
      .select("id");
    if (erroUpdate) {
      if (ehRecusaDeEtapaTravada(erroUpdate)) return { moveu: false, motivo: "etapa_travada", leadId: lead.id };
      logger.warn("[identidade-escolar] update de stage_id falhou", {
        lead_id: lead.id,
        organization_id: input.organizationId,
        error: erroUpdate.message,
      });
      return { moveu: false, motivo: "falha_de_escrita", leadId: lead.id };
    }
    if ((atualizadas ?? []).length === 0) return { moveu: false, motivo: "conflito_humano", leadId: lead.id };

    const atividade = await emitLeadActivity(admin, {
      organizationId: input.organizationId,
      leadId: lead.id,
      contactId: input.contactId,
      type: "stage_changed",
      sourceModule: "ai",
      sourceId: lead.id,
      actor: { type: "webhook_source", id: "identidade-escolar" },
      reason: stageChangeReason((origem as { name: string } | null)?.name ?? null, destino.name),
      payload: { motivo: "telefone_relacionado_a_aluno", de: lead.stage_id, para: destino.id },
    });
    if (!atividade.ok) {
      await registraFalhaDeAtividade(admin, {
        organizationId: input.organizationId,
        leadId: lead.id,
        tipo: "stage_changed",
        origem: "lib/leads/identidade-escolar",
        erro: atividade.error,
      });
    }
    // O mesmo evento dos outros escritores de etapa: automação e follow-up que
    // escutam `lead.stage_changed` reagem igual, venha o movimento de onde vier.
    const { error: erroEvento } = await admin.rpc("emit_event" as never, {
      p_event_type: "lead.stage_changed",
      p_entity_kind: "crm_lead",
      p_entity_id: lead.id,
      p_payload: { pipeline_id: lead.pipeline_id, from_stage_id: lead.stage_id, to_stage_id: destino.id, status: lead.status },
      p_metadata: { actor_kind: "system", source: "identidade-escolar" },
      p_organization_id: input.organizationId,
    } as never);
    if (erroEvento) {
      logger.error("[identidade-escolar] emit_event lead.stage_changed falhou", {
        lead_id: lead.id,
        organization_id: input.organizationId,
        error: (erroEvento as { message?: string }).message ?? String(erroEvento),
      });
    }
    return { moveu: true, motivo: "movido", leadId: lead.id };
  }
  return { moveu: false, motivo: "sem_etapa_academica" };
}
