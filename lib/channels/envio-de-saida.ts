/**
 * A TRAVA GLOBAL DE ENVIO: nenhuma mensagem de conversa sai sem `OUTBOUND_MESSAGING=enabled`.
 *
 * ## Por que existe
 *
 * Medido em produção (2026-09-26): mensagens saíram para clientes com o agente
 * pausado — o texto fixo do follow-up não exige agente, e cada caminho de envio
 * tinha a própria régua (agente publicado, fluxo ligado, canal conectado, modo de
 * teste). Régua espalhada é régua que alguém esquece de aplicar no emissor
 * seguinte. Esta é UMA pergunta, feita na fronteira com o canal, que nenhum
 * emissor contorna: a instalação autoriza sair mensagem?
 *
 * ## Fail-closed, e por quê
 *
 * Só o valor LITERAL `enabled` liga. Ausente, vazio, `disabled`, erro de
 * digitação — tudo desliga. O custo de errar para o lado fechado é uma mensagem
 * que não saiu e fica visível na conversa como `failed`/`outbound_disabled`; o
 * custo de errar para o lado aberto é falar com o cliente sem ninguém ter
 * decidido isso. Lida a cada chamada (e não no boot) para que o valor do `.env`
 * recarregado valha sem depender de cache de módulo.
 *
 * ## Onde é consultada (todas as saídas conhecidas — ver o teste da cerca)
 *
 *   1. `getAdapter()` (`lib/channels/index.ts`) — `send` e `sendTemplate` de
 *      TODO adapter lançam `EnvioDeSaidaDesligadoError`. É a fronteira final:
 *      qualquer emissor que chegue ao canal pelo seam passa aqui.
 *   2. `sendMessageHandler` — o hub de quase todo envio (Inbox, IA, follow-up,
 *      automação, campanha, prospecção, reunião, resposta aprovada, aviso de
 *      passagem, MCP). Barra ANTES de tocar o adapter e grava o desfecho
 *      honesto na linha: `failed` + `outbound_disabled` — nunca `queued`, que
 *      seria reenviado na reconexão, e nunca `sent`.
 *   3. `sendTemplateForSession` — o envio de modelo que o handler chama sem
 *      adapter.
 *   4. O redrive do `session-reconciler`, que fala HTTP direto com o transporte.
 */

/** Código gravado em `messages.error_code` quando a trava barra o envio. */
export const CODIGO_ENVIO_DESLIGADO = "outbound_disabled" as const;

/** Frase gravada em `messages.error_message` — é o que a conversa mostra. */
export const FRASE_ENVIO_DESLIGADO =
  "Envio de mensagens desligado nesta instalação. Nenhuma mensagem foi enviada.";

/** O envio de mensagens de conversa está autorizado nesta instalação? */
export function envioDeConversaLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OUTBOUND_MESSAGING?.trim() === "enabled";
}

export class EnvioDeSaidaDesligadoError extends Error {
  readonly code = CODIGO_ENVIO_DESLIGADO;
  constructor() {
    super(`${CODIGO_ENVIO_DESLIGADO}: ${FRASE_ENVIO_DESLIGADO}`);
    this.name = "EnvioDeSaidaDesligadoError";
  }
}

/** Lança `EnvioDeSaidaDesligadoError` quando a trava está fechada. */
export function exigirEnvioDeConversaLigado(env: NodeJS.ProcessEnv = process.env): void {
  if (!envioDeConversaLigado(env)) throw new EnvioDeSaidaDesligadoError();
}
