/**
 * Leitor do histórico no WAHA — SÓ LEITURA, por construção.
 *
 * A importação do histórico depende SÓ deste módulo para falar com o WAHA, e
 * ele só sabe fazer `GET` em dois caminhos:
 *
 *   GET /api/{sessão}/chats
 *   GET /api/{sessão}/chats/{chatId}/messages
 *
 * Não é uma subclasse nem um wrapper do `WahaClient` (que envia mensagem): não
 * herda nenhum método de envio, e um caminho fora da lista é recusado ANTES da
 * rede. `tests/unit/importacao-historico-so-le-o-waha.test.ts` reprova se este
 * módulo, ou qualquer arquivo da importação, importar cliente que envia.
 *
 * O NOWEB só responde estes caminhos com o Store ligado na sessão
 * (`config.noweb.store.enabled`). Sem ele, o WAHA devolve 400 — e isto vira
 * `store_desligado`, que a tela explica. Ligar o Store é decisão de quem opera a
 * instalação; este módulo nunca mexe na sessão.
 */
import type { WahaPayload } from "@/lib/waha/envelope";

export interface ConversaDoWaha {
  id: string;
  nome: string | null;
}

export interface PaginaDeConversas {
  limite: number;
  deslocamento: number;
}

export interface PaginaDeMensagens {
  limite: number;
  deslocamento: number;
  /** Inclusivo. */
  desde: Date;
  /** Exclusivo na régua do banco; aqui vai como teto em segundos. */
  ate: Date;
}

export interface LeitorDeHistorico {
  listarConversas(sessao: string, pagina: PaginaDeConversas): Promise<ConversaDoWaha[]>;
  listarMensagens(sessao: string, chatId: string, pagina: PaginaDeMensagens): Promise<WahaPayload[]>;
}

export type MotivoDeFalhaDeLeitura =
  | "store_desligado"
  | "sessao_desconhecida"
  | "chave_recusada"
  | "waha_indisponivel"
  | "resposta_invalida";

/** Falha que a importação sabe classificar: definitiva ou de tentar de novo. */
export class ErroDeLeituraDoHistorico extends Error {
  constructor(
    readonly motivo: MotivoDeFalhaDeLeitura,
    detalhe: string,
  ) {
    super(`${motivo}: ${detalhe}`);
    this.name = "ErroDeLeituraDoHistorico";
  }

  /** Indisponibilidade passa; as demais pedem gente (ligar Store, chave, sessão). */
  get transitorio(): boolean {
    return this.motivo === "waha_indisponivel";
  }
}

/** Os ÚNICOS caminhos que este leitor alcança. */
const CAMINHOS_PERMITIDOS: readonly RegExp[] = [
  /^\/api\/[^/]+\/chats$/,
  /^\/api\/[^/]+\/chats\/[^/]+\/messages$/,
];

export function caminhoPermitido(caminho: string): boolean {
  return CAMINHOS_PERMITIDOS.some((r) => r.test(caminho));
}

interface Opcoes {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  tetoMs?: number;
}

export function criarLeitorDeHistorico(opcoes: Opcoes): LeitorDeHistorico {
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const tetoMs = opcoes.tetoMs ?? 20_000;
  const base = opcoes.baseUrl.replace(/\/$/, "");

  async function get(caminho: string, query: Record<string, string>): Promise<unknown> {
    if (!caminhoPermitido(caminho)) {
      // Recusa ANTES da rede: um caminho novo aqui exige mudar a lista acima,
      // e a lista é revisada pela cerca de só-leitura.
      throw new Error(`leitor_do_historico_caminho_recusado: ${caminho}`);
    }
    const url = `${base}${caminho}?${new URLSearchParams(query).toString()}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), tetoMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        headers: { "X-Api-Key": opcoes.apiKey, Accept: "application/json" },
        signal: abort.signal,
      });
    } catch (erro) {
      throw new ErroDeLeituraDoHistorico(
        "waha_indisponivel",
        erro instanceof Error ? erro.message : String(erro),
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new ErroDeLeituraDoHistorico("resposta_invalida", "corpo não é JSON");
      }
    }
    const corpo = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 400 && /store/i.test(corpo)) {
      throw new ErroDeLeituraDoHistorico("store_desligado", corpo);
    }
    if (res.status === 404) throw new ErroDeLeituraDoHistorico("sessao_desconhecida", corpo);
    if (res.status === 401 || res.status === 403) {
      throw new ErroDeLeituraDoHistorico("chave_recusada", `HTTP ${res.status}`);
    }
    if (res.status >= 500 || res.status === 429) {
      throw new ErroDeLeituraDoHistorico("waha_indisponivel", `HTTP ${res.status}`);
    }
    // 400 sem menção ao Store: no NOWEB sem Store o corpo varia de versão para
    // versão. Na dúvida, é o mesmo caso — a ação de quem opera é a mesma.
    if (res.status === 400) throw new ErroDeLeituraDoHistorico("store_desligado", corpo);
    throw new ErroDeLeituraDoHistorico("resposta_invalida", `HTTP ${res.status}: ${corpo}`);
  }

  return {
    async listarConversas(sessao, pagina) {
      const corpo = await get(`/api/${encodeURIComponent(sessao)}/chats`, {
        limit: String(pagina.limite),
        offset: String(pagina.deslocamento),
      });
      if (!Array.isArray(corpo)) throw new ErroDeLeituraDoHistorico("resposta_invalida", "chats não é lista");
      const conversas: ConversaDoWaha[] = [];
      for (const bruto of corpo) {
        const id = idDoChat((bruto as { id?: unknown })?.id);
        if (!id) continue;
        const nome = (bruto as { name?: unknown }).name;
        conversas.push({ id, nome: typeof nome === "string" && nome.trim() ? nome.trim() : null });
      }
      return conversas;
    },

    async listarMensagens(sessao, chatId, pagina) {
      const corpo = await get(
        `/api/${encodeURIComponent(sessao)}/chats/${encodeURIComponent(chatId)}/messages`,
        {
          limit: String(pagina.limite),
          offset: String(pagina.deslocamento),
          // Mídia NUNCA é baixada: a decisão é importar só o registro.
          downloadMedia: "false",
          "filter.timestamp.gte": String(Math.floor(pagina.desde.getTime() / 1000)),
          "filter.timestamp.lte": String(Math.floor(pagina.ate.getTime() / 1000)),
        },
      );
      if (!Array.isArray(corpo)) {
        throw new ErroDeLeituraDoHistorico("resposta_invalida", "messages não é lista");
      }
      return corpo as WahaPayload[];
    },
  };
}

/** O id do chat vem como string ou como `{ _serialized }`, conforme a versão. */
function idDoChat(bruto: unknown): string | null {
  if (typeof bruto === "string") return bruto || null;
  if (bruto && typeof bruto === "object") {
    const s = (bruto as { _serialized?: unknown })._serialized;
    if (typeof s === "string" && s) return s;
  }
  return null;
}
