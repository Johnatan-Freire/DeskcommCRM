/**
 * A porta de entrada do seam. Feature nenhuma importa `lib/waha/*` direto —
 * pede o adapter do provider da conversa e o descritor de capabilities.
 */
import { datafyAdapter } from "./adapters/datafy";
import { metaCloudAdapter } from "./adapters/meta-cloud";
import { wahaAdapter } from "./adapters/waha";
import { socialAdapter } from "./social/adapter";
import { zernioAdapter } from "./adapters/zernio";
import { exigirEnvioDeConversaLigado } from "./envio-de-saida";
import type { ChannelAdapter, ChannelProvider, ProviderDeMensagem } from "./types";

/**
 * Um adapter por provider de MENSAGEM. `wacalls` não entra: ele não endereça
 * destinatário nem envia envelope — ver `ProviderDeMensagem` em `./types`.
 */
const ADAPTERS: Record<ProviderDeMensagem, ChannelAdapter | null> = {
  waha: wahaAdapter,
  meta_cloud: metaCloudAdapter,
  zernio: zernioAdapter,
  zernio_social: socialAdapter,
  datafy: datafyAdapter,
};

/**
 * O adapter que o resto do sistema recebe: o mesmo, com `send`/`sendTemplate`
 * atrás da trava global (`./envio-de-saida`). `Object.create` mantém todo o resto
 * (codes, resolveRecipient, capacidades opcionais) e o `this` de cada método.
 */
function atrasDaTravaDeSaida(adapter: ChannelAdapter): ChannelAdapter {
  const travado = Object.create(adapter) as ChannelAdapter;
  travado.send = async (envelope) => {
    exigirEnvioDeConversaLigado();
    return adapter.send(envelope);
  };
  const sendTemplate = adapter.sendTemplate;
  if (sendTemplate) {
    travado.sendTemplate = async (input) => {
      exigirEnvioDeConversaLigado();
      return sendTemplate.call(adapter, input);
    };
  }
  // Editar e apagar uma mensagem já entregue também mexem no WhatsApp do
  // cliente: são saída, e ficam atrás da mesma trava que o envio.
  const editMessage = adapter.editMessage;
  if (editMessage) {
    travado.editMessage = async (input) => {
      exigirEnvioDeConversaLigado();
      return editMessage.call(adapter, input);
    };
  }
  const revokeMessage = adapter.revokeMessage;
  if (revokeMessage) {
    travado.revokeMessage = async (input) => {
      exigirEnvioDeConversaLigado();
      return revokeMessage.call(adapter, input);
    };
  }
  return travado;
}

const TRAVADOS = new Map<ChannelAdapter, ChannelAdapter>();

/**
 * Fail-closed: provider sem adapter (ou fora da matriz) lança em vez de cair no
 * WAHA por default. Enviar pelo canal errado é pior que não enviar.
 */
export function getAdapter(provider: ChannelProvider): ChannelAdapter {
  const adapter = ADAPTERS[provider as ProviderDeMensagem];
  if (!adapter) throw new Error(`unknown_channel_provider: ${provider}`);
  let travado = TRAVADOS.get(adapter);
  if (!travado) {
    travado = atrasDaTravaDeSaida(adapter);
    TRAVADOS.set(adapter, travado);
  }
  return travado;
}

export {
  capabilitiesOf,
  CHANNEL_CAPABILITIES,
  DEFAULT_CHANNEL_PROVIDER,
  PROVIDERS_DE_MENSAGEM,
  PROVIDERS_SEM_MENSAGEM,
  canalConhecidoSemMensagem,
  transportaMensagem,
} from "./capabilities";
export { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef } from "./session-ref";
export type { ChannelSessionRef } from "./session-ref";
export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelProvider,
  ProviderDeMensagem,
  OutboundEnvelope,
  OutboundKind,
  OutboundMedia,
  RecipientInput,
} from "./types";
