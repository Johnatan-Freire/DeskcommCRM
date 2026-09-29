/**
 * DE QUEM É A PENDÊNCIA QUE O SILÊNCIO COBRA.
 *
 * `fn_silencio_pode_reengajar` responde "o atendimento automático está esperando o
 * cliente?" — e responde sim para QUALQUER IA que tenha falado por último. Numa
 * organização com dois agentes isso é pouco: o responsável pergunta a nota, o
 * agente de atendimento ao aluno responde "8,5", ninguém fala mais nada — e o fluxo
 * de reengajamento do agente COMERCIAL cobrava "Oi! Vi que você não respondeu…".
 * Não havia negociação aberta; havia uma pergunta respondida.
 *
 * A regra daqui: o fluxo de silêncio só cobra a conversa em que a ÚLTIMA fala da IA
 * depois da última mensagem do cliente saiu de um agente que HABILITOU aquele fluxo
 * (checkbox de follow-up na versão publicada do agente). A prova é objetiva e já é
 * gravada em toda mensagem da IA: `messages.metadata.ai_actor_id`, o id do agente
 * (`send-message.ts`, `agentActorId` do turno).
 *
 * Falha FECHADA nos dois casos sem dono identificável:
 *   * nenhuma fala da IA depois do último inbound (só automação/humano falou);
 *   * fala sem agente publicado (o ator de fallback `agent-engine`).
 * Em ambos não há agente dono da pendência, e cobrar em nome de alguém que não a
 * criou é exatamente o defeito.
 *
 * Consequência deliberada: fluxo de silêncio que NENHUM agente habilita não inscreve
 * mais ninguém por silêncio — que é também o que a tela do agente promete ("o fluxo
 * só vale para o agente que o marca").
 */

export type OrigemDaPendencia =
  | "autorizado"
  | "sem_fala_de_agente"
  | "agente_de_outro_fluxo";

/**
 * @param aiActorIdDaUltimaFala `metadata.ai_actor_id` da última mensagem `sent_via='ai'`
 *   posterior ao último inbound; `null` quando não há nenhuma.
 * @param agentesDoFluxo ids dos agentes publicados que habilitam este fluxo.
 */
export function decidirOrigemDaPendencia(
  aiActorIdDaUltimaFala: string | null,
  agentesDoFluxo: readonly string[],
): OrigemDaPendencia {
  if (aiActorIdDaUltimaFala === null || aiActorIdDaUltimaFala === "") return "sem_fala_de_agente";
  return agentesDoFluxo.includes(aiActorIdDaUltimaFala) ? "autorizado" : "agente_de_outro_fluxo";
}
