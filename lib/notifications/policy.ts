export function shouldNotifyInbound(input: {
  direction?: string | null;
  conversationId?: string | null;
  openConversationId?: string | null;
  tabFocused: boolean;
  tipo?: unknown;
  /**
   * `messages.origem` da linha. A importação do histórico (migration 0561) grava
   * `'historico'`, e cada linha importada chega pelo tempo real como INSERT de
   * mensagem recebida: sem esta régua, importar 300 mensagens antigas disparava
   * 300 avisos (e 300 consultas de "devo avisar?"). Histórico é DADO, nunca
   * evento — a mesma regra dos gatilhos e do dreno.
   */
  origem?: unknown;
}): boolean {
  if (input.tipo === "reassinado") return false;
  if (input.origem === "historico") return false;
  if (input.direction !== "inbound") return false;
  if (!input.conversationId) return false;
  if (input.tabFocused && input.openConversationId === input.conversationId) return false;
  return true;
}
