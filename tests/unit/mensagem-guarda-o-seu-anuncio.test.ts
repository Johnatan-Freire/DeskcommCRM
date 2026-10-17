/**
 * A mensagem nascida de um clique em anúncio guarda o SEU anúncio.
 *
 * ─── Por quê ─────────────────────────────────────────────────────────────────
 *
 * A atribuição do contato é PRIMEIRO TOQUE — gravada uma vez, nunca reescrita.
 * Numa loja com dois produtos, cada um com o seu anúncio "Clique para o
 * WhatsApp" e o mesmo texto pré-preenchido genérico, a pessoa que chegou pelo
 * anúncio A e dias depois clicou no B não deixava rastro do B em lugar nenhum:
 * a mensagem não guardava de qual anúncio nasceu. É esse rastro que a inbox
 * mostra na bolha e no painel ao lado (ver `anuncio-visivel-na-inbox.test.tsx`).
 *
 * ─── O que se prova aqui ─────────────────────────────────────────────────────
 *
 * A INGESTÃO grava o anúncio na própria mensagem (`metadata.anuncio`), nos três
 * transportes que sabem ler o clique — sem mexer no primeiro toque do contato,
 * e sem copiar o clique (`ctwa_clid`) nem o payload cru para cada mensagem.
 *
 * O que NÃO se prova aqui: o INSERT contra um Postgres real — o banco aqui é
 * de mentira.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
// Os efeitos pós-entrada (opt-out, lead, despacho do agente) não são o assunto
// e cada um tem teste próprio; aqui só importa o que a MENSAGEM grava.
vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: vi.fn() }));

import { ingestMetaInbound } from "@/lib/channels/meta/ingest";
import type { InboundMessageEvent } from "@/lib/channels/meta/webhook";
import { ingestZernioInbound } from "@/lib/channels/zernio/ingest";
import { dispatchWahaEvent, type WahaEnvelope } from "@/lib/waha/ingest";

// ─── O anúncio do segundo produto da loja ───────────────────────────────────

const ANUNCIO_B = {
  source_id: "120200000000000002",
  source_type: "ad",
  source_url: "https://fb.me/protetor-solar",
  headline: "Protetor solar para carro",
  body: "Proteja o painel do sol. Frete grátis.",
  thumbnail_url: "https://scontent.example.fbcdn.net/protetor-solar.jpg",
  media_type: "image",
  ctwa_clid: "ARAk_clique_B",
};

const TEXTO_GENERICO = "Qual é o preço e vocês entregam?";

// ─── A ingestão grava o anúncio na mensagem ────────────────────────────────

/**
 * Admin de mentira TOLERANTE: toda cadeia do PostgREST resolve vazia, as duas
 * RPCs de resolução devolvem id, e o INSERT de `messages` é registrado — é a
 * única escrita que este bloco mede.
 */
function adminTolerante() {
  const insertsDeMensagem: Array<Record<string, unknown>> = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const cadeia = (op: string): unknown => {
    const proxy: unknown = new Proxy(function () {}, {
      get(_alvo, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
        }
        if (prop === "maybeSingle" || prop === "single") {
          return async () => ({ data: op === "insert" ? { id: "mensagem-1" } : null, error: null });
        }
        return () => proxy;
      },
    });
    return proxy;
  };

  const admin = {
    from: (tabela: string) => ({
      select: () => cadeia("select"),
      insert: (linha: Record<string, unknown>) => {
        if (tabela === "messages") insertsDeMensagem.push(linha);
        return cadeia("insert");
      },
      update: () => cadeia("update"),
      upsert: () => cadeia("upsert"),
      delete: () => cadeia("delete"),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, insertsDeMensagem, rpcs };
}

const metadataGravada = (inserts: Array<Record<string, unknown>>) =>
  (inserts[0]?.metadata ?? null) as Record<string, unknown> | null;

const ANUNCIO_B_NA_MENSAGEM = {
  titulo: "Protetor solar para carro",
  texto: "Proteja o painel do sol. Frete grátis.",
  ad_id: "120200000000000002",
  // O link e a imagem, para a inbox MOSTRAR o anúncio na conversa.
  url: "https://fb.me/protetor-solar",
  miniatura: "https://scontent.example.fbcdn.net/protetor-solar.jpg",
};

describe("ingestão — a mensagem nascida de um clique guarda o SEU anúncio", () => {
  beforeEach(() => vi.clearAllMocks());

  // Fork Capital Code: bloco "canal intermediado" fora (canal da Meta não usado; ingest do fork mantido).


  // Fork Capital Code: bloco "canal oficial direto" fora (canal da Meta não usado; ingest do fork mantido).


  describe("canal por QR", () => {
    const envelope = (externalAdReply: Record<string, unknown> | null): WahaEnvelope => ({
      event: "message",
      session: "default",
      payload: {
        id: "false_5511999990000@c.us_CLIQUE_B",
        from: "5511999990000@c.us",
        fromMe: false,
        body: TEXTO_GENERICO,
        timestamp: 1_790_000_000,
        _data: {
          message: {
            extendedTextMessage: {
              text: TEXTO_GENERICO,
              contextInfo: externalAdReply ? { externalAdReply } : {},
            },
          },
        },
      },
    });
    const SESSION = { id: "sessao-1", organization_id: "org-1" };

    it("clique em anúncio: `metadata.anuncio` gravado junto do tipo cru", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await dispatchWahaEvent(
        admin as never,
        SESSION as never,
        envelope({
          title: "Protetor solar para carro",
          body: "Proteja o painel do sol. Frete grátis.",
          sourceId: "120200000000000002",
          sourceUrl: "https://fb.me/protetor-solar",
          thumbnailUrl: "https://scontent.example.fbcdn.net/protetor-solar.jpg",
          ctwaClid: "ARAk_clique_B",
          sourceType: "ad",
        }),
        "req-1",
      );
      const metadata = metadataGravada(insertsDeMensagem);
      expect(metadata?.anuncio).toEqual(ANUNCIO_B_NA_MENSAGEM);
      expect("raw_type" in (metadata ?? {})).toBe(true);
    });

    it("sem anúncio: a chave nem aparece", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await dispatchWahaEvent(admin as never, SESSION as never, envelope(null), "req-1");
      expect(insertsDeMensagem).toHaveLength(1);
      expect("anuncio" in (metadataGravada(insertsDeMensagem) ?? {})).toBe(false);
    });
  });
});
