import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CHAVE_DA_BARREIRA, desfechoDaBarreira, idDaMensagemDoEvento, origemDasMensagensDoLote } from "./barreira-de-eventos";

/** Admin falso que responde a `from('messages').select().in().neq()`. */
function adminFalso(resposta: { data?: { id: string }[]; error?: { message: string } }) {
  const pedidos: { ids: string[] }[] = [];
  const admin = {
    from(tabela: string) {
      expect(tabela).toBe("messages");
      return {
        select() {
          return {
            in(_coluna: string, ids: string[]) {
              pedidos.push({ ids });
              return {
                neq: async () => ({ data: resposta.data ?? [], error: resposta.error ?? null }),
              };
            },
          };
        },
      };
    },
  };
  return { admin: admin as never, pedidos };
}

const evento = (event_type: string, message_id?: string) => ({
  event_type,
  payload: message_id ? { message_id } : {},
});

const HANDLERS = ["ai-response", "ai-sentiment", "automation-rules", "followup-reactivity", "push"];

describe("barreira do histórico no dreno de eventos", () => {
  it("evento de mensagem histórica: TODOS os consumidores ficam de fora", async () => {
    const { admin } = adminFalso({ data: [{ id: "hist-1" }] });
    const origem = await origemDasMensagensDoLote(admin, [evento("message.received", "hist-1")]);
    const r = desfechoDaBarreira(evento("message.received", "hist-1"), origem, HANDLERS, "t");
    expect(r).toEqual(HANDLERS.map((k) => ({ consumer_key: k, status: "skipped", detail: "mensagem_historica" })));
  });

  it("evento de mensagem AO VIVO passa normalmente para os consumidores", async () => {
    const { admin } = adminFalso({ data: [] });
    const origem = await origemDasMensagensDoLote(admin, [evento("message.received", "viva-1")]);
    expect(desfechoDaBarreira(evento("message.received", "viva-1"), origem, HANDLERS, "t")).toBeNull();
  });

  it("na dúvida sobre a origem, nenhum evento de mensagem é despachado (volta à fila)", async () => {
    const { admin } = adminFalso({ error: { message: "timeout" } });
    const origem = await origemDasMensagensDoLote(admin, [evento("message.received", "x")]);
    expect(desfechoDaBarreira(evento("message.received", "x"), origem, HANDLERS, "2026-10-06T00:00:00Z")).toEqual([
      { consumer_key: CHAVE_DA_BARREIRA, status: "retry", retry_at: "2026-10-06T00:00:00Z", detail: "origem_da_mensagem_indisponivel" },
    ]);
  });

  it("evento que não é de mensagem não é tocado, e não custa consulta", async () => {
    const { admin, pedidos } = adminFalso({ data: [] });
    const origem = await origemDasMensagensDoLote(admin, [evento("lead.created"), evento("ai.handoff_triggered")]);
    expect(pedidos).toHaveLength(0);
    expect(desfechoDaBarreira(evento("lead.created"), origem, HANDLERS, "t")).toBeNull();
    expect(idDaMensagemDoEvento(evento("message.sent", "m"))).toBe("m");
    expect(idDaMensagemDoEvento(evento("media.persist_requested", "m"))).toBeNull();
  });

  it("o lote inteiro custa UMA consulta", async () => {
    const { admin, pedidos } = adminFalso({ data: [] });
    await origemDasMensagensDoLote(admin, [
      evento("message.received", "a"),
      evento("message.sent", "b"),
      evento("message.received", "a"),
    ]);
    expect(pedidos).toEqual([{ ids: ["a", "b"] }]);
  });

  it("o dreno consulta a barreira ANTES de despachar — sem atalho para dispatchEvent", () => {
    const src = readFileSync("lib/event-log/drain.ts", "utf8");
    // Um único ponto de despacho, e ele é o FALLBACK da barreira.
    expect([...src.matchAll(/dispatchEvent\(row\)/g)]).toHaveLength(1);
    const barreira = src.indexOf("desfechoDaBarreira(");
    const despacho = src.indexOf("dispatchEvent(row)");
    expect(barreira).toBeGreaterThan(-1);
    expect(barreira).toBeLessThan(despacho);
    expect(src.slice(barreira, despacho)).toMatch(/\)\s*\?\?\s*\(await $/);
    expect(src).toMatch(/const origem = await origemDasMensagensDoLote\(admin,/);
  });
});
