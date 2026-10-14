/**
 * O calendário de feriados do atendimento humano (migration 0660), lido pelos
 * três lugares que perguntam "a equipe está no horário?" — o roteamento, o roster
 * da API e a disponibilidade do motor. A REGRA (feriado vence a jornada) mora em
 * `isWithinSchedule`; aqui só a leitura.
 *
 * A janela é curta de propósito: ontem até daqui a 30 dias cobre "agora" em
 * qualquer fuso e a estimativa de reabertura (que varre até 21 dias). Falha de
 * leitura devolve lista vazia — a jornada semanal continua valendo, como antes
 * do calendário existir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import type { Queryable } from "@/lib/agent-engine/queue/queue";

const DIAS_ANTES = 1;
const DIAS_DEPOIS = 30;

function janela(agora: Date): { de: string; ate: string } {
  const dia = 24 * 3600_000;
  return {
    de: new Date(agora.getTime() - DIAS_ANTES * dia).toISOString().slice(0, 10),
    ate: new Date(agora.getTime() + DIAS_DEPOIS * dia).toISOString().slice(0, 10),
  };
}

/** Motor (`pg`). */
export async function feriadosDaOrganizacaoPg(db: Queryable, organizationId: string, agora: Date): Promise<string[]> {
  const { de, ate } = janela(agora);
  try {
    const { rows } = await db.query(
      `select to_char(data, 'YYYY-MM-DD') as data from feriados_de_atendimento
        where organization_id = $1 and data between $2::date and $3::date`,
      [organizationId, de, ate],
    );
    return (rows as Array<{ data: string }>).map((r) => r.data);
  } catch (err) {
    logger.warn("[feriados] leitura falhou — vale só a jornada semanal", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** API (supabase-js, service role com filtro de organização explícito). */
export async function feriadosDaOrganizacao(
  admin: SupabaseClient,
  organizationId: string,
  agora: Date,
): Promise<string[]> {
  const { de, ate } = janela(agora);
  try {
    const { data, error } = await admin
      .from("feriados_de_atendimento")
      .select("data")
      .eq("organization_id", organizationId)
      .gte("data", de)
      .lte("data", ate);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ data: string }>).map((r) => String(r.data).slice(0, 10));
  } catch (err) {
    logger.warn("[feriados] leitura falhou — vale só a jornada semanal", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Para a tela Equipe: os feriados de 30 dias atrás em diante, em ordem. */
export async function feriadosParaATela(
  admin: SupabaseClient,
  organizationId: string,
): Promise<Array<{ id: string; data: string; descricao: string }>> {
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await admin
    .from("feriados_de_atendimento")
    .select("id, data, descricao")
    .eq("organization_id", organizationId)
    .gte("data", desde)
    .order("data")
    .limit(200);
  return (data ?? []) as Array<{ id: string; data: string; descricao: string }>;
}
