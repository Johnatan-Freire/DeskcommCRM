/**
 * Quais tools NATIVAS o escopo do agente esconde (migration 0404).
 *
 * Duas camadas, de propósito:
 *   1. aqui — a tool nem entra no turno: o modelo não vê o que não pode usar, e
 *      não gasta passo tentando;
 *   2. no executor — `verificarPermissaoDeMoverFunil` recusa mesmo assim, se por
 *      qualquer caminho a chamada chegar (tool vinda de outro lugar, turno montado
 *      por um chamador futuro que esqueça esta função).
 *
 * O que sai, e por quê:
 *   - `update_lead_state`: agente acadêmico nunca move o funil; agente sem
 *     `can_update_lead_state` também não;
 *   - `schedule_followup`: follow-up é comercial (a política da etapa acadêmica
 *     o recusa no envio) — oferecer ao agente acadêmico seria prometer ao contato
 *     um retorno que o sistema não vai mandar.
 *
 * Sem agente publicado (`null`): nada muda — é o comportamento de antes.
 */
export function ferramentasOcultasPeloEscopo(
  config: { serviceScope: 'comercial' | 'academico'; canUpdateLeadState: boolean } | null,
): string[] {
  if (config === null) return [];
  const ocultas: string[] = [];
  if (config.serviceScope === 'academico' || !config.canUpdateLeadState) ocultas.push('update_lead_state');
  if (config.serviceScope === 'academico') ocultas.push('schedule_followup');
  return ocultas;
}
