/**
 * O sweep de silêncio só inscreve quem a régua central autoriza (migration 0403).
 *
 * O incidente (produção, 2026-09-26): o fluxo "Lead sem resposta" reengajou 21
 * conversas com o agente PAUSADO — conversas que um humano encerrou ("Por nada
 * ☺️") e conversas em handoff. O sweep contava só o último inbound. A régua
 * inteira (quem falou por último, humano, agente no ar, ativação) mora em
 * `fn_silencio_pode_reengajar` e é medida contra Postgres real em
 * `tests/invariants/corte-temporal-de-ativacao.test.ts`; aqui se mede que o
 * sweep A CONSULTA, com a conversa certa, e obedece à resposta.
 */
import { describe, expect, it } from "vitest";

import { createSupabaseSilenceSweepDb } from "@/lib/followup/silence-sweep";

function conversa(contactId: string) {
  const conversationId = `conversation-${contactId}`;
  return {
    id: conversationId,
    service_revision: 1,
    current_demanda_id: null,
    demandas: null,
    status: "open",
    contact_id: contactId,
    last_inbound_at: "2026-09-01T10:00:00.000Z",
    messages: [{
      organization_id: "org",
      contact_id: contactId,
      conversation_id: conversationId,
      service_revision: 1,
      demanda_id: null,
      demanda_revision: null,
      sent_at: "2026-09-01T10:00:00.000Z",
    }],
    contacts: { tags: [], is_blocked: false, ai_authorized_at: null, phone_number: "+5585900000000" },
    sessao: { metadata: { ai_gate: "open" } },
  };
}

function supabase(data: unknown[], regua: (conversationId: string) => string | Error) {
  const perguntas: Array<Record<string, unknown>> = [];
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
      return () => chain;
    },
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name !== "fn_silencio_pode_reengajar") throw new Error(`rpc inesperada: ${name}`);
    perguntas.push(args);
    const r = regua(args.p_conversation as string);
    return r instanceof Error ? { data: null, error: { message: r.message } } : { data: r, error: null };
  };
  return { admin: { from: () => chain, rpc } as never, perguntas };
}

const CORTE = "2026-09-02T10:00:00.000Z";

describe("sweep de silêncio × régua central de reengajamento", () => {
  it("inscreve só quem a régua autoriza; humano/agente parado/encerrada ficam de fora", async () => {
    const recusas: Record<string, string> = {
      "conversation-humano": "humano_falou_por_ultimo",
      "conversa-inexistente": "conversa_desconhecida",
      "conversation-pausado": "nenhum_agente_no_ar",
      "conversation-handoff": "humano_atendendo",
    };
    const { admin, perguntas } = supabase(
      ["ok", "humano", "pausado", "handoff"].map(conversa),
      (id) => recusas[id] ?? "autorizado",
    );
    const ids = await createSupabaseSilenceSweepDb(admin).loadSilentContactIds("org", CORTE, []);
    expect(ids).toEqual(["ok"]);
    // Uma pergunta por candidato, com a conversa do candidato e para INSCREVER
    // (é o que liga "um reengajamento por silêncio").
    expect(perguntas).toHaveLength(4);
    expect(perguntas[0]).toEqual({ p_org: "org", p_conversation: "conversation-ok", p_para_inscrever: true });
  });

  it("régua fora do ar: NINGUÉM é inscrito (fail-closed — o pointer falha inteiro)", async () => {
    const { admin } = supabase([conversa("ok")], () => new Error("db down"));
    await expect(
      createSupabaseSilenceSweepDb(admin).loadSilentContactIds("org", CORTE, []),
    ).rejects.toThrow(/db down/);
  });

  it("controle: com a régua autorizando todos, todos os silenciosos entram", async () => {
    const { admin } = supabase(["a", "b"].map(conversa), () => "autorizado");
    await expect(
      createSupabaseSilenceSweepDb(admin).loadSilentContactIds("org", CORTE, []),
    ).resolves.toEqual(["a", "b"]);
  });
});
