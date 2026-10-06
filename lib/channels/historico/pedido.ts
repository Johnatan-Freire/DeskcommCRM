/**
 * O pedido de importação que a tela faz, e as colunas que ela lê do recibo.
 *
 * A janela é contada PARA TRÁS a partir da primeira conexão do número: é ali
 * que o histórico termina — o que veio depois chegou ao vivo e já está no CRM.
 */
import { z } from "zod";

export const JANELA_PADRAO_DIAS = 90;
export const JANELA_MAXIMA_DIAS = 730;

export const pedidoDeImportacaoSchema = z.object({
  janela_dias: z.number().int().min(1).max(JANELA_MAXIMA_DIAS).default(JANELA_PADRAO_DIAS),
});

export function janelaDoPedido(primeiraConexao: Date, dias: number): { inicio: Date; fim: Date } {
  return { inicio: new Date(primeiraConexao.getTime() - dias * 86_400_000), fim: primeiraConexao };
}

export const COLUNAS_DO_RECIBO =
  "id, channel_session_id, status, motivo_falha, janela_inicio, janela_fim, conversas_total, conversas_processadas, mensagens_importadas, mensagens_duplicadas, mensagens_fora_da_janela, mensagens_descartadas, contatos_criados, conversas_criadas, created_at, started_at, finished_at";

export interface ReciboDaImportacao {
  id: string;
  channel_session_id: string;
  status: "pendente" | "em_andamento" | "concluida" | "falhou" | "cancelada";
  motivo_falha: string | null;
  janela_inicio: string;
  janela_fim: string;
  conversas_total: number | null;
  conversas_processadas: number;
  mensagens_importadas: number;
  mensagens_duplicadas: number;
  mensagens_fora_da_janela: number;
  mensagens_descartadas: number;
  contatos_criados: number;
  conversas_criadas: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
