/**
 * O ✓✓ DA MENSAGEM ENVIADA PELO CRM NÃO SE PERDE (medido em produção, 15/10/2026).
 *
 * Toda mensagem mandada pelo Inbox ficava com um ✓, embora tivesse chegado: o
 * WAHA manda o `message.ack` ~0,2 s depois do envio, e a linha do envio só ganha
 * `external_id` quando o canal responde (0,7–2,6 s). O ack não achava a linha
 * (ou achava o eco, que o envio apaga em seguida) e o degrau se perdia.
 *
 * Aqui: o webhook de ack pelo caminho de produção (`dispatchWahaEvent`) contra
 * um banco de mentira que aplica os filtros de verdade — inclusive o `or` da
 * regra monotônica, que é o que decide "só sobe".
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { ackDeProgresso, camposAoConfirmarEnvio, maiorAck } from "@/lib/messaging/progresso-da-entrega";
import { dispatchWahaEvent, type WahaPayload } from "@/lib/waha/ingest";

type Linha = Record<string, unknown> & { id: string };

const ORG = "org-1";
const SESSION = { id: "sessao-1", organization_id: ORG };
const BARE = "3EB0DF40D769623FA876B4";
const COMPOSTO = `true_144435673305113@lid_${BARE}`;

/**
 * `messages` em memória. `aoProcurarEnvioEmVoo` encena a corrida: é chamado
 * quando o webhook pergunta se há envio em voo — o momento em que, na vida real,
 * o envio termina e carimba o id.
 */
function banco(linhas: Linha[], aoProcurarEnvioEmVoo?: () => void) {
  const contagem = { updates: 0 };
  const consulta = (modo: "select" | "update", patch?: Record<string, unknown>) => {
    const filtros: Array<(r: Linha) => boolean> = [];
    let ehBuscaDeEmVoo = false;
    const q = {
      eq(c: string, v: unknown) {
        filtros.push((r) => r[c] === v);
        return q;
      },
      in(c: string, vs: unknown[]) {
        if (c === "status") ehBuscaDeEmVoo = true;
        filtros.push((r) => vs.includes(r[c]));
        return q;
      },
      is(c: string, v: unknown) {
        filtros.push((r) => (r[c] ?? null) === v);
        return q;
      },
      gte() {
        return q;
      },
      limit() {
        return q;
      },
      // `ack.is.null,ack.lt.N` — a regra monotônica.
      or(expr: string) {
        const n = Number(/ack\.lt\.(-?\d+)/.exec(expr)?.[1]);
        filtros.push((r) => r.ack == null || (r.ack as number) < n);
        return q;
      },
      select() {
        return q;
      },
      then(ok: (v: unknown) => unknown) {
        if (ehBuscaDeEmVoo && aoProcurarEnvioEmVoo) {
          const casadas = linhas.filter((r) => filtros.every((f) => f(r)));
          aoProcurarEnvioEmVoo();
          return Promise.resolve(ok({ data: casadas, error: null }));
        }
        const casadas = linhas.filter((r) => filtros.every((f) => f(r)));
        if (modo === "update") {
          contagem.updates++;
          casadas.forEach((r) => Object.assign(r, patch));
        }
        return Promise.resolve(ok({ data: casadas.map((r) => ({ id: r.id })), error: null }));
      },
    };
    return q;
  };
  const admin = {
    from: () => ({
      update: (patch: Record<string, unknown>) => consulta("update", patch),
      select: () => consulta("select"),
    }),
  };
  return { admin, contagem };
}

function ack(n: number | undefined, id = COMPOSTO): WahaPayload {
  return { id, ack: n } as WahaPayload;
}

async function receber(admin: unknown, p: WahaPayload) {
  await dispatchWahaEvent(admin as never, SESSION as never, { event: "message.ack", session: "s", payload: p }, "req-1");
}

describe("regra do degrau", () => {
  it("só ack de progresso conta (≥ 1); 0, -1 e lixo não", () => {
    expect([1, 2, 3, 4].map(ackDeProgresso)).toEqual([1, 2, 3, 4]);
    expect([0, -1, null, undefined, "2", 2.5].map(ackDeProgresso)).toEqual([null, null, null, null, null, null]);
  });

  it("vence o maior degrau visto, não o último", () => {
    expect(maiorAck([3, 1, 2])).toBe(3);
    expect(maiorAck([0, null])).toBeNull();
  });

  it("ao confirmar o envio: sem degrau herdado é `sent`; com ✓✓ herdado nasce `delivered`", () => {
    expect(camposAoConfirmarEnvio(null, "t")).toEqual({ ack: 0, status: "sent" });
    expect(camposAoConfirmarEnvio(1, "t")).toEqual({ ack: 1, status: "sent" });
    expect(camposAoConfirmarEnvio(2, "t")).toEqual({ ack: 2, status: "delivered", delivered_at: "t" });
    expect(camposAoConfirmarEnvio(3, "t")).toMatchObject({ ack: 3, status: "read", read_at: "t" });
  });
});

describe("webhook message.ack", () => {
  it("casa pela cauda do id e marca entregue", async () => {
    const linhas: Linha[] = [{ id: "m1", organization_id: ORG, external_id: BARE, ack: 0, status: "sent" }];
    const { admin } = banco(linhas);
    await receber(admin, ack(2));
    expect(linhas[0]).toMatchObject({ ack: 2, status: "delivered" });
  });

  it("⭐ só sobe: um ack 2 atrasado não rebaixa uma mensagem já lida", async () => {
    const linhas: Linha[] = [{ id: "m1", organization_id: ORG, external_id: BARE, ack: 3, status: "read" }];
    const { admin } = banco(linhas);
    await receber(admin, ack(2));
    expect(linhas[0]).toMatchObject({ ack: 3, status: "read" });
  });

  it("⭐ ack 0 não rebaixa para `sending` uma mensagem entregue", async () => {
    const linhas: Linha[] = [{ id: "m1", organization_id: ORG, external_id: BARE, ack: 2, status: "delivered" }];
    const { admin, contagem } = banco(linhas);
    await receber(admin, ack(0));
    expect(linhas[0]).toMatchObject({ ack: 2, status: "delivered" });
    expect(contagem.updates).toBe(0);
  });

  it("⭐ a corrida: o ack chega antes de o envio gravar o id — espera e aplica", async () => {
    const envio: Linha = {
      id: "envio",
      organization_id: ORG,
      external_id: null,
      direction: "outbound",
      status: "sending",
      ack: null,
    };
    // O envio termina (e carimba o id + `sent`) enquanto o webhook espera.
    const { admin } = banco([envio], () => {
      Object.assign(envio, { external_id: BARE, status: "sent", ack: 0 });
    });
    await receber(admin, ack(2));
    expect(envio).toMatchObject({ external_id: BARE, ack: 2, status: "delivered" });
  });

  it("sem envio em voo e sem a linha (ack de mensagem que o CRM não tem): não espera", async () => {
    const { admin, contagem } = banco([]);
    const inicio = Date.now();
    await receber(admin, ack(2));
    expect(contagem.updates).toBe(1);
    expect(Date.now() - inicio).toBeLessThan(300);
  });
});
