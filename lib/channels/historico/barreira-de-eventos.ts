/**
 * Segunda camada da importação do histórico: o dreno de eventos não entrega a
 * NENHUM consumidor um evento de mensagem cuja mensagem é histórica.
 *
 * A primeira camada é o banco — os gatilhos de `messages` nem emitem evento
 * para `origem = 'historico'` (migration 0561). Esta não confia nela: um
 * gatilho futuro, uma emissão manual, um replay, e o evento existiria. Então,
 * antes de `dispatchEvent`, o dreno pergunta ao banco a origem das mensagens do
 * lote, numa consulta só.
 *
 * Fail-closed: se a pergunta falhar, NENHUM evento de mensagem do lote é
 * despachado — eles voltam para a fila (retry), e o próximo tick pergunta de
 * novo. Na dúvida sobre a origem, ninguém responde.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";

type Admin = ReturnType<typeof createAdminClient>;

export const CHAVE_DA_BARREIRA = "barreira-do-historico";

/** O `message_id` de um evento de mensagem, ou null se o evento não é de mensagem. */
export function idDaMensagemDoEvento(row: Pick<EventRow, "event_type" | "payload">): string | null {
  if (!row.event_type.startsWith("message.")) return null;
  const id = (row.payload as { message_id?: unknown } | null)?.message_id;
  return typeof id === "string" && id ? id : null;
}

export interface OrigemDoLote {
  /** Mensagens do lote cuja origem NÃO é `ao_vivo`. */
  historicas: ReadonlySet<string>;
  /** A pergunta falhou: nenhum evento de mensagem pode ser despachado. */
  indisponivel: boolean;
}

export async function origemDasMensagensDoLote(
  admin: Admin,
  rows: readonly Pick<EventRow, "event_type" | "payload">[],
): Promise<OrigemDoLote> {
  const ids = [...new Set(rows.map(idDaMensagemDoEvento).filter((id): id is string => id !== null))];
  if (ids.length === 0) return { historicas: new Set(), indisponivel: false };
  const { data, error } = await admin
    .from("messages")
    .select("id, origem")
    .in("id", ids)
    .neq("origem", "ao_vivo");
  if (error) return { historicas: new Set(), indisponivel: true };
  return {
    historicas: new Set(((data ?? []) as { id: string }[]).map((m) => m.id)),
    indisponivel: false,
  };
}

/**
 * O que o dreno grava no lugar de despachar. `null` = despache normalmente.
 * `handlersDoEvento` são as chaves que `dispatchEvent` chamaria.
 */
export function desfechoDaBarreira(
  row: Pick<EventRow, "event_type" | "payload">,
  origem: OrigemDoLote,
  handlersDoEvento: readonly string[],
  retryAt: string,
): HandlerResult[] | null {
  const id = idDaMensagemDoEvento(row);
  if (!id) return null;
  if (origem.indisponivel) {
    return [{ consumer_key: CHAVE_DA_BARREIRA, status: "retry", retry_at: retryAt, detail: "origem_da_mensagem_indisponivel" }];
  }
  if (origem.historicas.has(id)) {
    return handlersDoEvento.map((key) => ({ consumer_key: key, status: "skipped", detail: "mensagem_historica" }));
  }
  return null;
}
