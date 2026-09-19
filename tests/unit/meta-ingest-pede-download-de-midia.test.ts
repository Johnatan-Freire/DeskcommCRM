/**
 * ÁUDIO, FOTO, VÍDEO E DOCUMENTO RECEBIDOS PELO CANAL OFICIAL PASSAM A APARECER.
 *
 * ─── O defeito ───────────────────────────────────────────────────────────────
 *
 * O aviso que a Cloud API da Meta manda NUNCA traz o arquivo — traz um
 * `media_id`, que só serve para pedir o arquivo depois, numa chamada à parte.
 * `ingestMetaInbound` gravava a mensagem e guardava esse id em
 * `metadata.meta_media_id` — e nada nunca lia esse campo. O `media_url` da
 * linha ficava `null`, `workers/media-persist-worker.ts` via isso e pulava
 * ("no media_url"), e nenhum evento `media.persist_requested` era emitido
 * para começar o download. O cliente via a mensagem; o anexo nunca chegava, e
 * nada na tela dizia que havia algo ali. Achado ao triar o CHANGELOG do
 * upstream (melgarafael/DeskcommCRM v1.17.0/v1.20.0) — mesmo gap.
 *
 * ─── O conserto ─────────────────────────────────────────────────────────────
 *
 * `media_id` passa a ir para `media_url` (o campo genérico que o worker de
 * persistência já sabe olhar, provider-agnóstico desde a introdução do canal
 * intermediado), e a ingestão emite `media.persist_requested` — o MESMO
 * evento e formato de payload que o canal WAHA já emite. Quem baixa de fato é
 * `metaCloudAdapter.fetchInboundMedia` (testado em
 * `channel-adapter-meta.test.ts`), plugado no worker pela mesma indireção que
 * já existe para os outros canais.
 *
 * `aplicarEfeitosPosEntrada` é mockada: este arquivo mede só a fiação de
 * mídia, não opt-out/pipeline/despacho do agente, que têm dono em outro lugar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: vi.fn(async () => undefined),
}));

const { ingestMetaInbound } = await import("@/lib/channels/meta/ingest");
const { aplicarEfeitosPosEntrada } = await import("@/lib/channels/pos-entrada");
type InboundMessageEvent = Parameters<typeof ingestMetaInbound>[1];

const ORG = "11111111-0000-4000-8000-000000000001";
const SESSAO_ID = "sessao-1";
const CONTATO_ID = "contato-1";
const CONVERSA_ID = "conversa-1";
const MENSAGEM_ID = "mensagem-1";

interface Chamada {
  rpc: string;
  args: Record<string, unknown>;
}

function adminFalso() {
  const chamadas: Chamada[] = [];
  let mensagemInserida: Record<string, unknown> | null = null;

  const from = (tabela: string) => {
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: () => alvo,
      is: () => alvo,
      in: () => alvo,
      limit: () => alvo,
      insert: (payload: Record<string, unknown>) => {
        if (tabela === "messages") mensagemInserida = payload;
        return alvo;
      },
      maybeSingle: async () => {
        if (tabela === "channel_sessions") {
          return { data: { id: SESSAO_ID, organization_id: ORG }, error: null };
        }
        if (tabela === "contacts") return { data: null, error: null };
        if (tabela === "messages") return { data: { id: MENSAGEM_ID }, error: null };
        return { data: null, error: null };
      },
    };
    return alvo;
  };

  const rpc = async (nome: string, args: Record<string, unknown>) => {
    chamadas.push({ rpc: nome, args });
    if (nome === "fn_upsert_wa_contact") return { data: CONTATO_ID, error: null };
    if (nome === "fn_upsert_wa_conversation") return { data: CONVERSA_ID, error: null };
    return { data: null, error: null };
  };

  return {
    chamadas,
    mensagemInseridaRef: () => mensagemInserida,
    client: { from, rpc } as unknown as SupabaseClient,
  };
}

const BASE: Omit<InboundMessageEvent, "media" | "type" | "text"> = {
  kind: "inbound_message",
  wabaId: "waba-1",
  phoneNumberId: "111",
  externalId: "wamid.MIDIA1",
  from: "5531998966398",
  profileName: "Cliente",
  sentAt: new Date("2026-09-19T12:00:00.000Z"),
};

beforeEach(() => {
  vi.mocked(aplicarEfeitosPosEntrada).mockClear();
});

describe("ingestão do canal oficial — mídia pede download", () => {
  it("⭐ mensagem de imagem grava o media_id em media_url e emite media.persist_requested", async () => {
    const { client, chamadas, mensagemInseridaRef } = adminFalso();
    const evento: InboundMessageEvent = {
      ...BASE,
      type: "image",
      text: null,
      media: { id: "1234567890", mime: "image/jpeg", voice: false },
    } as InboundMessageEvent;

    const r = await ingestMetaInbound(client, evento, { organizationId: ORG });

    expect(r.status).toBe("ingested");
    expect(mensagemInseridaRef()).toMatchObject({ media_url: "1234567890", media_mime: "image/jpeg" });
    // Nada de duplicar o id em metadata: media_url é a fonte única que o
    // worker de persistência olha.
    expect((mensagemInseridaRef()?.metadata as Record<string, unknown>)?.meta_media_id).toBeUndefined();

    const emitiu = chamadas.find((c) => c.rpc === "emit_event");
    expect(emitiu, "não emitiu media.persist_requested").toBeDefined();
    expect(emitiu?.args).toMatchObject({
      p_event_type: "media.persist_requested",
      p_entity_kind: "message",
      p_entity_id: MENSAGEM_ID,
      p_organization_id: ORG,
      p_payload: { message_id: MENSAGEM_ID, conversation_id: CONVERSA_ID },
    });
  });

  it("mensagem de texto NÃO emite media.persist_requested (nada para baixar)", async () => {
    const { client, chamadas } = adminFalso();
    const evento: InboundMessageEvent = { ...BASE, type: "text", text: "oi", media: null } as InboundMessageEvent;

    await ingestMetaInbound(client, evento, { organizationId: ORG });

    expect(chamadas.some((c) => c.rpc === "emit_event")).toBe(false);
  });

  it("áudio de nota de voz preserva `voice:true` em metadata, sem meta_media_id", async () => {
    const { client, mensagemInseridaRef } = adminFalso();
    const evento: InboundMessageEvent = {
      ...BASE,
      type: "audio",
      text: null,
      media: { id: "audio-999", mime: "audio/ogg", voice: true },
    } as InboundMessageEvent;

    await ingestMetaInbound(client, evento, { organizationId: ORG });

    expect(mensagemInseridaRef()).toMatchObject({ media_url: "audio-999" });
    expect((mensagemInseridaRef()?.metadata as Record<string, unknown>)?.voice).toBe(true);
  });
});
