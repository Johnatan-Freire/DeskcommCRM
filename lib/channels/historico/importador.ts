/**
 * Avança UMA importação de histórico por rodada do cron, em lotes, retomável.
 *
 * O que este módulo NÃO consegue fazer, por construção: enviar mensagem. As
 * duas portas que ele recebe são o leitor do WAHA (só GET) e o repositório
 * (recibo + `fn_importar_conversa_historica`). Não há terceira porta.
 *
 * Ordem: lista os chats uma vez (o cursor guarda a lista), e então, chat a
 * chat, pagina as mensagens da janela — da mais nova para a mais velha, como o
 * WAHA devolve — e entrega cada página ao banco. O cursor é salvo a cada página,
 * então uma rodada interrompida recomeça de onde parou, e o banco deduplica o
 * que for entregue de novo.
 */
import type { WahaPayload } from "@/lib/waha/envelope";

import { ErroDeLeituraDoHistorico, type LeitorDeHistorico } from "./leitor-waha";
import { contatoDoChat, mensagemParaImportar, type ContatoParaImportar, type MensagemParaImportar } from "./mapear";

export interface CursorDaImportacao {
  /** Ids dos chats de pessoa, na ordem em que serão importados. */
  chats?: string[];
  /** Nome que o WAHA deu a cada chat, quando deu. */
  nomes?: Record<string, string>;
  indice?: number;
  deslocamento?: number;
}

export interface ImportacaoEmCurso {
  id: string;
  organizationId: string;
  sessaoWaha: string;
  status: "pendente" | "em_andamento";
  janelaInicio: Date;
  janelaFim: Date;
  /** `channel_sessions.first_connected_at` — tudo importado é anterior a isto. */
  primeiraConexao: Date | null;
  cursor: CursorDaImportacao;
}

export interface ResultadoDoLote {
  importadas: number;
  duplicadas: number;
  fora_da_janela: number;
  descartadas: number;
}

export interface RepositorioDaImportacao {
  proxima(): Promise<ImportacaoEmCurso | null>;
  iniciar(id: string): Promise<void>;
  salvarCursor(
    id: string,
    cursor: CursorDaImportacao,
    progresso: { conversasTotal?: number; conversasProcessadas?: number },
  ): Promise<void>;
  importarConversa(
    id: string,
    contato: ContatoParaImportar,
    mensagens: MensagemParaImportar[],
  ): Promise<ResultadoDoLote>;
  concluir(id: string): Promise<void>;
  falhar(id: string, motivo: string): Promise<void>;
}

/** O banco recusa quando a importação deixou de estar em andamento (cancelada). */
export class ImportacaoInterrompida extends Error {
  constructor(detalhe: string) {
    super(detalhe);
    this.name = "ImportacaoInterrompida";
  }
}

export interface ResumoDaRodada {
  importacaoId: string | null;
  desfecho: "nada_a_fazer" | "avancou" | "concluida" | "falhou" | "interrompida" | "aguardando_waha";
  motivo?: string;
  lotes: number;
  mensagensImportadas: number;
}

const POR_PAGINA_DE_CHATS = 200;
const POR_PAGINA_DE_MENSAGENS = 100;
/** Teto de segurança: uma instalação com mais chats que isto importa os mais recentes. */
const MAXIMO_DE_CHATS = 20_000;

export async function avancarImportacao(deps: {
  repo: RepositorioDaImportacao;
  leitor: LeitorDeHistorico;
  agora?: () => number;
  orcamentoMs?: number;
}): Promise<ResumoDaRodada> {
  const agora = deps.agora ?? Date.now;
  const fim = agora() + (deps.orcamentoMs ?? 40_000);
  const resumo: ResumoDaRodada = { importacaoId: null, desfecho: "nada_a_fazer", lotes: 0, mensagensImportadas: 0 };

  const imp = await deps.repo.proxima();
  if (!imp) return resumo;
  resumo.importacaoId = imp.id;

  // Fail-closed: sem o instante da primeira conexão, não há como afirmar que
  // uma mensagem é histórica. O banco recusa também; aqui a falha fica legível.
  if (!imp.primeiraConexao) {
    await deps.repo.falhar(imp.id, "sessao_sem_primeira_conexao");
    return { ...resumo, desfecho: "falhou", motivo: "sessao_sem_primeira_conexao" };
  }
  if (imp.status === "pendente") await deps.repo.iniciar(imp.id);

  const teto = new Date(Math.min(imp.janelaFim.getTime(), imp.primeiraConexao.getTime()));
  const cursor: CursorDaImportacao = { ...imp.cursor };

  try {
    if (!cursor.chats) {
      const { chats, nomes } = await listarChatsDePessoas(deps.leitor, imp.sessaoWaha);
      cursor.chats = chats;
      cursor.nomes = nomes;
      cursor.indice = 0;
      cursor.deslocamento = 0;
      await deps.repo.salvarCursor(imp.id, cursor, { conversasTotal: chats.length, conversasProcessadas: 0 });
    }

    while ((cursor.indice ?? 0) < cursor.chats.length) {
      if (agora() >= fim) {
        return { ...resumo, desfecho: "avancou" };
      }
      const chatId = cursor.chats[cursor.indice ?? 0];
      if (chatId === undefined) break;
      const pagina = await deps.leitor.listarMensagens(imp.sessaoWaha, chatId, {
        limite: POR_PAGINA_DE_MENSAGENS,
        deslocamento: cursor.deslocamento ?? 0,
        desde: imp.janelaInicio,
        ate: teto,
      });

      const mensagens = pagina
        .map(mensagemParaImportar)
        .filter((m): m is MensagemParaImportar => m !== null);
      const contato = contatoDoChat(chatId, cursor.nomes?.[chatId] ?? null, pagina as WahaPayload[]);
      if (contato && mensagens.length > 0) {
        const r = await deps.repo.importarConversa(imp.id, contato, mensagens);
        resumo.lotes += 1;
        resumo.mensagensImportadas += r.importadas;
      }

      if (pagina.length < POR_PAGINA_DE_MENSAGENS) {
        cursor.indice = (cursor.indice ?? 0) + 1;
        cursor.deslocamento = 0;
      } else {
        cursor.deslocamento = (cursor.deslocamento ?? 0) + pagina.length;
      }
      await deps.repo.salvarCursor(imp.id, cursor, { conversasProcessadas: cursor.indice });
    }

    await deps.repo.concluir(imp.id);
    return { ...resumo, desfecho: "concluida" };
  } catch (erro) {
    if (erro instanceof ImportacaoInterrompida) {
      return { ...resumo, desfecho: "interrompida", motivo: erro.message };
    }
    if (erro instanceof ErroDeLeituraDoHistorico) {
      if (erro.transitorio) {
        // WAHA fora do ar: a importação espera, sem queimar o que já fez.
        await deps.repo.salvarCursor(imp.id, cursor, { conversasProcessadas: cursor.indice });
        return { ...resumo, desfecho: "aguardando_waha", motivo: erro.motivo };
      }
      await deps.repo.falhar(imp.id, erro.motivo);
      return { ...resumo, desfecho: "falhou", motivo: erro.motivo };
    }
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    await deps.repo.falhar(imp.id, `erro_inesperado: ${detalhe.slice(0, 200)}`);
    return { ...resumo, desfecho: "falhou", motivo: "erro_inesperado" };
  }
}

async function listarChatsDePessoas(
  leitor: LeitorDeHistorico,
  sessao: string,
): Promise<{ chats: string[]; nomes: Record<string, string> }> {
  const chats: string[] = [];
  const nomes: Record<string, string> = {};
  const vistos = new Set<string>();
  for (let deslocamento = 0; chats.length < MAXIMO_DE_CHATS; deslocamento += POR_PAGINA_DE_CHATS) {
    const pagina = await leitor.listarConversas(sessao, { limite: POR_PAGINA_DE_CHATS, deslocamento });
    for (const c of pagina) {
      if (vistos.has(c.id) || !contatoDoChat(c.id, c.nome)) continue;
      vistos.add(c.id);
      chats.push(c.id);
      if (c.nome) nomes[c.id] = c.nome;
    }
    if (pagina.length < POR_PAGINA_DE_CHATS) break;
  }
  return { chats, nomes };
}
