/**
 * O importador contra um WAHA FALSO: 10.000 mensagens chegam ao banco e o
 * WAHA só recebe GET de leitura — qualquer outra chamada FALHA o teste na hora.
 */
import { describe, expect, it } from "vitest";

import { avancarImportacao, type CursorDaImportacao, type ImportacaoEmCurso, type RepositorioDaImportacao } from "./importador";
import { criarLeitorDeHistorico } from "./leitor-waha";
import type { ContatoParaImportar, MensagemParaImportar } from "./mapear";

const CORTE = new Date("2026-09-21T19:41:34Z");
const SESSAO = "org_teste";

/** WAHA falso: `chats` chats de pessoa (+1 grupo +1 status), `porChat` mensagens cada. */
function wahaFalso(opcoes: { chats: number; porChat: number; storeDesligado?: boolean }) {
  const chamadas: { metodo: string; caminho: string }[] = [];
  const proibidas: string[] = [];
  const chats = [
    ...Array.from({ length: opcoes.chats }, (_, i) => ({ id: `5511${String(900000000 + i)}@c.us`, name: `Pessoa ${i}` })),
    { id: "120363000000000000@g.us", name: "Grupo" },
    { id: "status@broadcast", name: null },
  ];
  const fetchImpl: typeof fetch = async (entrada, init) => {
    const url = new URL(String(entrada));
    const metodo = (init?.method ?? "GET").toUpperCase();
    chamadas.push({ metodo, caminho: url.pathname });
    if (metodo !== "GET" || /send|forward|reply|seen|sessions/i.test(url.pathname)) {
      proibidas.push(`${metodo} ${url.pathname}`);
      throw new Error(`CHAMADA PROIBIDA AO WAHA: ${metodo} ${url.pathname}`);
    }
    if (opcoes.storeDesligado) {
      return new Response('{"message":"Enable NOWEB store \'config.noweb.store.enabled\'"}', { status: 400 });
    }
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    if (url.pathname.endsWith("/chats")) {
      return Response.json(chats.slice(offset, offset + limit));
    }
    const chatId = decodeURIComponent(url.pathname.split("/")[4]!);
    const gte = Number(url.searchParams.get("filter.timestamp.gte"));
    const lte = Number(url.searchParams.get("filter.timestamp.lte"));
    expect(url.searchParams.get("downloadMedia")).toBe("false");
    const todas = Array.from({ length: opcoes.porChat }, (_, k) => {
      const ts = Math.floor(CORTE.getTime() / 1000) - 86_400 - k * 60;
      const deMim = k % 3 === 0;
      return {
        id: `${deMim}_${chatId}_ID${k}`,
        timestamp: ts,
        from: deMim ? "me@c.us" : chatId,
        fromMe: deMim,
        body: `mensagem ${k}`,
        hasMedia: k % 10 === 0,
        type: "chat",
      };
    }).filter((m) => m.timestamp >= gte && m.timestamp <= lte);
    return Response.json(todas.slice(offset, offset + limit));
  };
  return { fetchImpl, chamadas, proibidas };
}

function repoEmMemoria(base: Partial<ImportacaoEmCurso> = {}) {
  const estado = {
    status: "pendente" as string,
    cursor: {} as CursorDaImportacao,
    lotes: [] as { contato: ContatoParaImportar; mensagens: MensagemParaImportar[] }[],
    motivo: null as string | null,
    total: 0,
  };
  const repo: RepositorioDaImportacao = {
    async proxima() {
      if (estado.status !== "pendente" && estado.status !== "em_andamento") return null;
      return {
        id: "imp-1",
        organizationId: "org-1",
        sessaoWaha: SESSAO,
        status: estado.status as "pendente" | "em_andamento",
        janelaInicio: new Date(CORTE.getTime() - 90 * 86_400_000),
        janelaFim: new Date("2026-10-06T00:00:00Z"),
        primeiraConexao: CORTE,
        cursor: estado.cursor,
        ...base,
      };
    },
    async iniciar() {
      estado.status = "em_andamento";
    },
    async salvarCursor(_id, cursor, p) {
      estado.cursor = JSON.parse(JSON.stringify(cursor)) as CursorDaImportacao;
      if (p.conversasTotal !== undefined) estado.total = p.conversasTotal;
    },
    async importarConversa(_id, contato, mensagens) {
      estado.lotes.push({ contato, mensagens });
      return { importadas: mensagens.length, duplicadas: 0, fora_da_janela: 0, descartadas: 0 };
    },
    async concluir() {
      estado.status = "concluida";
    },
    async falhar(_id, motivo) {
      estado.status = "falhou";
      estado.motivo = motivo;
    },
  };
  return { repo, estado };
}

describe("importador do histórico", () => {
  it("10.000 mensagens chegam ao banco; o WAHA só recebe GET de leitura", async () => {
    const waha = wahaFalso({ chats: 100, porChat: 100 });
    const { repo, estado } = repoEmMemoria();
    const leitor = criarLeitorDeHistorico({ baseUrl: "http://waha.falso", apiKey: "k", fetchImpl: waha.fetchImpl });

    let rodadas = 0;
    while (estado.status !== "concluida" && rodadas < 50) {
      await avancarImportacao({ repo, leitor, orcamentoMs: 60_000 });
      rodadas += 1;
    }

    expect(estado.status).toBe("concluida");
    const mensagens = estado.lotes.flatMap((l) => l.mensagens);
    expect(mensagens).toHaveLength(10_000);
    expect(new Set(mensagens.map((m) => m.external_id)).size).toBe(10_000);
    expect(estado.total).toBe(100); // grupo e status ficaram de fora
    expect(estado.lotes.every((l) => l.contato.kind === "phone")).toBe(true);
    expect(mensagens.every((m) => new Date(m.sent_at) < CORTE)).toBe(true);
    expect(mensagens.filter((m) => m.from_me)).toHaveLength(3_400);

    expect(waha.proibidas).toEqual([]);
    expect(waha.chamadas.every((c) => c.metodo === "GET")).toBe(true);
    expect(waha.chamadas.every((c) => /^\/api\/org_teste\/chats(\/[^/]+\/messages)?$/.test(c.caminho))).toBe(true);
  });

  it("retoma do cursor quando o orçamento acaba no meio — sem repetir nem pular", async () => {
    const waha = wahaFalso({ chats: 30, porChat: 250 });
    const { repo, estado } = repoEmMemoria();
    const leitor = criarLeitorDeHistorico({ baseUrl: "http://waha.falso", apiKey: "k", fetchImpl: waha.fetchImpl });
    let relogio = 0;
    // Cada chamada a `agora` anda 1 unidade; orçamento de 5 = poucas páginas por rodada.
    const agora = () => (relogio += 1);
    let rodadas = 0;
    while (estado.status !== "concluida" && rodadas < 500) {
      await avancarImportacao({ repo, leitor, agora, orcamentoMs: 5 });
      rodadas += 1;
    }
    expect(rodadas).toBeGreaterThan(5);
    const ids = estado.lotes.flatMap((l) => l.mensagens.map((m) => m.external_id));
    expect(ids).toHaveLength(30 * 250);
    expect(new Set(ids).size).toBe(30 * 250);
  });

  it("Store desligado: a importação FALHA legível e não mexe na sessão", async () => {
    const waha = wahaFalso({ chats: 3, porChat: 3, storeDesligado: true });
    const { repo, estado } = repoEmMemoria();
    const leitor = criarLeitorDeHistorico({ baseUrl: "http://waha.falso", apiKey: "k", fetchImpl: waha.fetchImpl });
    const r = await avancarImportacao({ repo, leitor });
    expect(r.desfecho).toBe("falhou");
    expect(estado.motivo).toBe("store_desligado");
    expect(waha.proibidas).toEqual([]);
    expect(waha.chamadas).toHaveLength(1);
  });

  it("sem primeira conexão do número, falha sem ler o WAHA (fail-closed)", async () => {
    const waha = wahaFalso({ chats: 3, porChat: 3 });
    const { repo, estado } = repoEmMemoria({ primeiraConexao: null });
    const leitor = criarLeitorDeHistorico({ baseUrl: "http://waha.falso", apiKey: "k", fetchImpl: waha.fetchImpl });
    const r = await avancarImportacao({ repo, leitor });
    expect(r.desfecho).toBe("falhou");
    expect(estado.motivo).toBe("sessao_sem_primeira_conexao");
    expect(waha.chamadas).toHaveLength(0);
  });

  it("WAHA fora do ar: a importação espera, sem falhar nem perder o cursor", async () => {
    const { repo, estado } = repoEmMemoria();
    const leitor = criarLeitorDeHistorico({
      baseUrl: "http://waha.falso",
      apiKey: "k",
      fetchImpl: async () => new Response("", { status: 503 }),
    });
    const r = await avancarImportacao({ repo, leitor });
    expect(r.desfecho).toBe("aguardando_waha");
    expect(estado.status).toBe("em_andamento");
  });
});
