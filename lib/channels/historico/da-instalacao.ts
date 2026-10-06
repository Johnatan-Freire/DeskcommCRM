/**
 * O que a importação do histórico precisa saber do transporte desta instalação,
 * dito por quem pode nomeá-lo (a fronteira `lib/channels/`). Rotas e tela
 * perguntam CAPACIDADE, nunca o nome do provider.
 */
import { criarLeitorDeHistorico, type LeitorDeHistorico } from "./leitor-waha";

/** O leitor do histórico do transporte configurado, ou null se não há transporte. */
export function leitorDoHistoricoDaInstalacao(): LeitorDeHistorico | null {
  const url = process.env.WAHA_API_BASE_URL;
  const key = process.env.WAHA_API_KEY;
  if (!url || !key || key === "dev_plaintext_change_me") return null;
  return criarLeitorDeHistorico({ baseUrl: url, apiKey: key });
}

/**
 * Só número pareado por QR tem histórico legível: o canal oficial não expõe
 * conversa anterior à conexão. `provider` nulo é o legado (anterior à coluna),
 * que era sempre pareado por QR.
 */
export function numeroTemHistoricoLegivel(provider: string | null): boolean {
  return provider === null || provider === "waha";
}
