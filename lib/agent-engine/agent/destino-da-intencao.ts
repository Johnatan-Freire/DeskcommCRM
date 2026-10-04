import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import {
  COLUNAS_DA_ORIGEM,
  transfereParaOFunil,
  type OrigemDaTransferencia,
} from "@/lib/leads/transfere-para-o-funil";

export type StatusDoDestino =
  /** A intenção não declarou funil — o roteamento de sempre (#2155). */
  | "sem_destino"
  /** Nenhum negócio aberto do contato: não há card a mover. */
  | "sem_negocio"
  /** Dois negócios empatados: mover um seria chute (§3.2). */
  | "nao_roteado"
  /** O card já está no funil destino — nada a fazer, sem retroceder. */
  | "ja_no_destino"
  /**
   * O contato JÁ tem outro negócio aberto no funil destino: transferir criaria
   * o segundo card do mesmo cliente no mesmo funil. Não se move nada.
   */
  | "destino_ocupado"
  | "transferido"
  /** A transferência recusou (`stage_pipeline_mismatch`, etapa, etc.). */
  | "recusado";

export interface ResultadoDoDestino {
  status: StatusDoDestino;
  error?: string;
  origemId?: string;
  cloneId?: string;
}

export interface DestinoDaIntencaoDeps {
  admin: SupabaseClient;
  organizationId: string;
  /** O CONTATO do turno (`leadId` em inbound-turn), não o id do negócio. */
  contactId: string;
  destinoPipelineId: string;
  destinoStageId: string | null;
  handlerCtx: HandlerCtx;
}

/**
 * Leva o card do contato para o funil que a intenção do roteador declarou (#2155).
 *
 * O roteador escolhia o AGENTE e o card ficava no funil de entrada: o agente do
 * produto não escrevia nele. Aqui o destino é aplicado com a MESMA transferência
 * das regras de automação (`transfereParaOFunil`: clona no destino e encerra a
 * origem como transferência) — duas implementações de "trocar de funil"
 * divergiriam na primeira mudança de uma delas.
 *
 * Quatro recusas são silenciosas e propositalmente não são erro: card já no
 * destino (idempotente em toda mensagem seguinte), destino já com negócio aberto
 * (não duplica o card do cliente), sem negócio aberto e alvo ambíguo — a única
 * coisa visível ao cliente final que este caminho pode causar é mover o card
 * errado.
 */
export async function aplicaDestinoDaIntencao(
  deps: DestinoDaIntencaoDeps,
): Promise<ResultadoDoDestino> {
  const { data, error } = await deps.admin
    .from("crm_leads")
    .select(`${COLUNAS_DA_ORIGEM}, last_activity_at`)
    .eq("organization_id", deps.organizationId)
    .eq("contact_id", deps.contactId)
    .eq("status", "open");
  if (error) return { status: "recusado", error: error.message };

  const abertos = ((data ?? []) as unknown as OrigemDaTransferencia[]).map(
    (linha) => linha as OrigemDaTransferencia & LeadCandidate,
  );
  if (abertos.length === 0) return { status: "sem_negocio" };

  // Primeiro o DESTINO: se o contato já tem negócio aberto lá, nada se move —
  // e esta leitura vem antes de escolher o alvo, porque dois negócios abertos
  // (um em cada funil) são ambíguos para `resolveActiveLeadForContact` e cairiam
  // em `nao_roteado` com a resposta certa escondida atrás do motivo errado.
  const noDestino = abertos.filter((linha) => linha.pipeline_id === deps.destinoPipelineId);
  if (noDestino.length > 0) {
    // Um único negócio, e ele já está no destino: o card é o próprio.
    if (abertos.length === 1) return { status: "ja_no_destino", origemId: noDestino[0]!.id };
    return { status: "destino_ocupado", origemId: noDestino[0]!.id };
  }

  const alvo = resolveActiveLeadForContact(abertos);
  if (!alvo.routed) {
    return { status: "nao_roteado", error: alvo.reason };
  }

  const origem = abertos.find((linha) => linha.id === alvo.leadId);
  if (origem === undefined) return { status: "sem_negocio" };

  const transferencia = await transfereParaOFunil(
    deps.admin,
    deps.organizationId,
    deps.handlerCtx,
    origem,
    deps.destinoPipelineId,
    deps.destinoStageId,
    "Levado para outro funil pelo roteador de intenção",
  );
  if (!transferencia.ok) {
    return { status: "recusado", error: transferencia.error, origemId: origem.id };
  }
  return {
    status: "transferido",
    origemId: origem.id,
    cloneId: String(transferencia.clone.id ?? ""),
  };
}
