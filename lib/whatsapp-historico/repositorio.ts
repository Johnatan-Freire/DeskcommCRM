/**
 * O recibo da importação (`whatsapp_history_imports`) e a escrita no banco
 * (`fn_importar_conversa_historica`), com o client de service role.
 *
 * Service role ignora RLS, então cada escrita aqui filtra pela importação, e a
 * importação carrega a organização que o POST resolveu da SESSÃO do admin —
 * nunca do corpo da requisição.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

import {
  ImportacaoInterrompida,
  type CursorDaImportacao,
  type ImportacaoEmCurso,
  type RepositorioDaImportacao,
  type ResultadoDoLote,
} from "./importador";

type Admin = ReturnType<typeof createAdminClient>;

interface LinhaDaImportacao {
  id: string;
  organization_id: string;
  status: "pendente" | "em_andamento";
  janela_inicio: string;
  janela_fim: string;
  cursor: CursorDaImportacao | null;
  channel_sessions: { waha_session_name: string; first_connected_at: string | null; organization_id: string } | null;
}

export function criarRepositorioDaImportacao(admin: Admin): RepositorioDaImportacao {
  const tabela = () => admin.from("whatsapp_history_imports" as never);

  const repo: RepositorioDaImportacao = {
    async proxima(): Promise<ImportacaoEmCurso | null> {
      const { data, error } = await tabela()
        .select(
          "id, organization_id, status, janela_inicio, janela_fim, cursor, channel_sessions(waha_session_name, first_connected_at, organization_id)",
        )
        .in("status", ["pendente", "em_andamento"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`whatsapp_history_imports.select: ${error.message}`);
      const linha = data as unknown as LinhaDaImportacao | null;
      if (!linha) return null;
      const sessao = linha.channel_sessions;
      // A sessão TEM de ser da mesma organização da importação. Não deveria
      // divergir (FK + POST), mas se divergir não se lê nada de ninguém.
      if (!sessao || sessao.organization_id !== linha.organization_id) {
        await repo.falhar(linha.id, "sessao_de_outra_organizacao");
        return null;
      }
      return {
        id: linha.id,
        organizationId: linha.organization_id,
        sessaoWaha: sessao.waha_session_name,
        status: linha.status,
        janelaInicio: new Date(linha.janela_inicio),
        janelaFim: new Date(linha.janela_fim),
        primeiraConexao: sessao.first_connected_at ? new Date(sessao.first_connected_at) : null,
        cursor: linha.cursor ?? {},
      };
    },

    async iniciar(id) {
      const { error } = await tabela()
        .update({ status: "em_andamento", started_at: new Date().toISOString() } as never)
        .eq("id", id)
        .eq("status", "pendente");
      if (error) throw new Error(`whatsapp_history_imports.iniciar: ${error.message}`);
    },

    async salvarCursor(id, cursor, progresso) {
      const patch: Record<string, unknown> = { cursor };
      if (progresso.conversasTotal !== undefined) patch.conversas_total = progresso.conversasTotal;
      if (progresso.conversasProcessadas !== undefined) patch.conversas_processadas = progresso.conversasProcessadas;
      const { error } = await tabela().update(patch as never).eq("id", id).eq("status", "em_andamento");
      if (error) throw new Error(`whatsapp_history_imports.cursor: ${error.message}`);
    },

    async importarConversa(id, contato, mensagens): Promise<ResultadoDoLote> {
      const { data, error } = await admin.rpc("fn_importar_conversa_historica" as never, {
        p_import: id,
        p_contato: contato,
        p_mensagens: mensagens,
      } as never);
      if (error) {
        if (/importacao_nao_esta_em_andamento/.test(error.message)) throw new ImportacaoInterrompida(error.message);
        throw new Error(`fn_importar_conversa_historica: ${error.message}`);
      }
      const r = (data ?? {}) as Partial<ResultadoDoLote>;
      return {
        importadas: r.importadas ?? 0,
        duplicadas: r.duplicadas ?? 0,
        fora_da_janela: r.fora_da_janela ?? 0,
        descartadas: r.descartadas ?? 0,
      };
    },

    async concluir(id) {
      const { error } = await tabela()
        .update({ status: "concluida", finished_at: new Date().toISOString() } as never)
        .eq("id", id)
        .eq("status", "em_andamento");
      if (error) throw new Error(`whatsapp_history_imports.concluir: ${error.message}`);
    },

    async falhar(id, motivo) {
      const { error } = await tabela()
        .update({ status: "falhou", motivo_falha: motivo, finished_at: new Date().toISOString() } as never)
        .eq("id", id)
        .in("status", ["pendente", "em_andamento"]);
      if (error) throw new Error(`whatsapp_history_imports.falhar: ${error.message}`);
    },
  };
  return repo;
}
