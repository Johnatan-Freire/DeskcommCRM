/**
 * O FOLLOW-UP DE SILÊNCIO SÓ COBRA A PENDÊNCIA DO AGENTE QUE O HABILITA (T19/T20).
 *
 * Responsável: "Qual foi a nota do meu filho?" — agente de atendimento ao aluno:
 * "8,5." — silêncio. A régua SQL (`fn_silencio_pode_reengajar`) diz "a IA falou por
 * último, pode reengajar", e o fluxo comercial cobrava. Aqui se mede que a varredura
 * pergunta DE QUEM foi a fala e só inscreve quando o autor habilita o fluxo.
 */
import { describe, expect, it, vi } from "vitest";

import { decidirOrigemDaPendencia } from "@/lib/followup/origem-da-pendencia";
import { createSupabaseSilenceSweepDb, runSilenceSweep, type SilenceSweepDb } from "@/lib/followup/silence-sweep";
import { AGENTE_DO_FLUXO, comFalaDoAgente } from "../support/fala-do-agente";

const AGENTE_DO_ALUNO = "00000000-0000-4000-8000-0000000a1000";

describe("decidirOrigemDaPendencia (regra pura)", () => {
  it("fala do agente que habilita o fluxo → autorizado", () => {
    expect(decidirOrigemDaPendencia(AGENTE_DO_FLUXO, [AGENTE_DO_FLUXO])).toBe("autorizado");
  });
  it("fala de OUTRO agente (atendimento ao aluno) → não cobra", () => {
    expect(decidirOrigemDaPendencia(AGENTE_DO_ALUNO, [AGENTE_DO_FLUXO])).toBe("agente_de_outro_fluxo");
  });
  it("sem fala da IA depois do último inbound → não cobra", () => {
    expect(decidirOrigemDaPendencia(null, [AGENTE_DO_FLUXO])).toBe("sem_fala_de_agente");
  });
  it("ator de fallback sem agente publicado ('agent-engine') → não cobra", () => {
    expect(decidirOrigemDaPendencia("agent-engine", [AGENTE_DO_FLUXO])).toBe("agente_de_outro_fluxo");
  });
  it("fluxo que nenhum agente habilita (texto fixo solto) → não cobra ninguém", () => {
    expect(decidirOrigemDaPendencia(AGENTE_DO_FLUXO, [])).toBe("agente_de_outro_fluxo");
  });
});

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
    contacts: { tags: [], is_blocked: false, ai_authorized_at: null, phone_number: "+5561900000000" },
    sessao: { metadata: { ai_gate: "open" } },
  };
}

function admin(autor: string | null) {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: [conversa("resp")], error: null });
      return () => chain;
    },
  });
  // A régua SQL AUTORIZA: é exatamente o caso em que ela sozinha não basta.
  return comFalaDoAgente({ from: () => chain, rpc: async () => ({ data: "autorizado", error: null }) }, autor);
}

const CORTE = "2026-09-02T10:00:00.000Z";

describe("varredura de silêncio × dono da pendência (consulta de produção)", () => {
  it("T19/T20: 'nota 8,5' do agente do aluno + silêncio NÃO entra no fluxo comercial", async () => {
    const ids = await createSupabaseSilenceSweepDb(admin(AGENTE_DO_ALUNO)).loadSilentContactIds(
      "org", CORTE, [], [AGENTE_DO_FLUXO],
    );
    expect(ids).toEqual([]);
  });

  it("controle: a mesma conversa com a fala do agente COMERCIAL entra", async () => {
    const ids = await createSupabaseSilenceSweepDb(admin(AGENTE_DO_FLUXO)).loadSilentContactIds(
      "org", CORTE, [], [AGENTE_DO_FLUXO],
    );
    expect(ids).toEqual(["resp"]);
  });

  it("sem fala da IA depois do último inbound: não entra", async () => {
    const ids = await createSupabaseSilenceSweepDb(admin(null)).loadSilentContactIds(
      "org", CORTE, [], [AGENTE_DO_FLUXO],
    );
    expect(ids).toEqual([]);
  });
});

describe("runSilenceSweep entrega os agentes que HABILITAM o pointer", () => {
  it("passa só os agentes do pointer, não os de outros fluxos", async () => {
    const recebido = vi.fn(async () => [] as string[]);
    const db: SilenceSweepDb = {
      loadActiveSilencePointers: async () => [
        { id: "p-comercial", organization_id: "org", active_version_id: "v1", threshold_minutes: 1440, segments: [] },
      ],
      loadSilentContactIds: recebido,
      loadTriggerNode: async () => ({ id: "trigger", pedeAgente: false }),
      insertEnrollment: async () => ({ inserted: true }),
    };
    await runSilenceSweep({
      db,
      gateDb: {
        loadEnabledPublishedFollowupAgents: async () => [
          { agentId: AGENTE_DO_FLUXO, pointerIds: ["p-comercial"] },
          { agentId: AGENTE_DO_ALUNO, pointerIds: [] },
        ],
      },
      clock: () => new Date("2026-09-03T10:00:00.000Z"),
    });
    expect(recebido).toHaveBeenCalledWith("org", expect.any(String), [], [AGENTE_DO_FLUXO]);
  });
});
