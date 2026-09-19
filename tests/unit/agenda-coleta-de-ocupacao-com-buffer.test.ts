/**
 * A COLETA DE OCUPAÇÃO ENXERGA O QUE O INTERVALO ANTES/DEPOIS ALCANÇA.
 *
 * ─── O defeito ───────────────────────────────────────────────────────────────
 *
 * `horariosLivres` (o motor) infla cada horário candidato pelo
 * `buffer_before_minutes`/`buffer_after_minutes` do tipo de atendimento — é
 * assim que ele evita oferecer um horário colado num compromisso vizinho. Mas
 * a COLETA de compromissos usava a janela CRUA [de, ate). Um vizinho que
 * termina DENTRO do buffer (ex.: termina 12:45, o candidato é 13:00 com 30 min
 * de intervalo antes) nunca era buscado no banco — ficava invisível para quem
 * decide o que está ocupado, mesmo que o MOTOR quisesse recusá-lo.
 *
 * Isso importa mais na ESCRITA do que na leitura: a tela pede uma janela larga
 * (a semana inteira) e o vizinho cai lá dentro de qualquer jeito. Mas a escrita
 * (`exigeHorarioLivre`) chama esta mesma função com de/ate = exatamente o slot
 * pedido — e é exatamente aí que a janela crua deixa passar o vizinho que o
 * buffer deveria bloquear. Achado ao triar o CHANGELOG do upstream
 * (melgarafael/DeskcommCRM v1.33.0) — mesmo defeito lá.
 *
 * ─── E o efeito colateral, se só isso fosse consertado ──────────────────────
 *
 * Alargar a coleta sem mais nada faria um agendamento REMARCADO se ver como
 * vizinho de si mesmo: a linha antiga (ainda com o horário de origem, porque o
 * UPDATE ainda não rodou) passaria a cair dentro da janela alargada do próprio
 * horário de destino, e mover um compromisso para logo depois do seu próprio
 * fim seria recusado por "conflito" — com ele mesmo. `ignorarAgendamentoId`
 * existe para isso: a remarcação exclui a própria linha da coleta.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { horariosLivresDaOrg } from "@/lib/agenda/consulta";

const ORG = "org-1";
const DONO = "dono-1";
const TIPO_ID = "tipo-1";

interface Filtro {
  tabela: string;
  op: string;
  col: string;
  val: unknown;
}

/**
 * Um PostgREST de mentira. `calendar_appointments` é a tabela sob teste: seus
 * filtros são registrados em `filtros` para o teste inspecionar a JANELA real
 * usada na coleta, e suas linhas vêm de `agendamentosNaTabela`.
 */
function fakeSupabase(opts: {
  bufferAntesMin: number;
  bufferDepoisMin: number;
  agendamentosNaTabela: Array<{ id: string; starts_at: string; ends_at: string; status: string }>;
}) {
  const filtros: Filtro[] = [];

  const tipoRow = {
    id: TIPO_ID,
    name: "Consulta",
    is_active: true,
    duration_minutes: 60,
    buffer_before_minutes: opts.bufferAntesMin,
    buffer_after_minutes: opts.bufferDepoisMin,
    minimum_notice_minutes: 0,
    slot_interval_minutes: 30,
    booking_window_days: 30,
    default_owner_user_id: DONO,
  };

  // Jornada aberta o dia inteiro, todo dia da semana, no fuso de referência —
  // só para o motor ter o que consultar; não é o que este teste mede.
  const scheduleAberto = {
    timezone: "America/Sao_Paulo",
    windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      dow,
      start: "00:00",
      end: "23:59",
    })),
  };

  function builder(tabela: string) {
    const local: Array<[string, unknown]> = [];
    const registrar = (op: string) => (col: string, val: unknown) => {
      local.push([col, val]);
      filtros.push({ tabela, op, col, val });
      return q;
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: registrar("eq"),
      neq: registrar("neq"),
      gte: registrar("gte"),
      lte: registrar("lte"),
      lt: registrar("lt"),
      gt: registrar("gt"),
      maybeSingle: async () => {
        if (tabela === "calendar_event_types") return { data: tipoRow, error: null };
        if (tabela === "attendant_availability") return { data: { schedule: scheduleAberto }, error: null };
        return { data: null, error: null };
      },
      then: (r: (v: { data: unknown; error: null }) => unknown) => {
        if (tabela === "calendar_appointments") {
          const excluido = local.find(([c]) => c === "id")?.[1];
          const linhas = opts.agendamentosNaTabela.filter((a) => a.id !== excluido);
          return Promise.resolve({ data: linhas, error: null }).then(r);
        }
        // calendar_availability_exceptions, calendar_connections, calendar_external_events: vazio.
        return Promise.resolve({ data: [], error: null }).then(r);
      },
    };
    return q;
  }

  const client = { from: (tabela: string) => builder(tabela) } as unknown as SupabaseClient;
  return { client, filtros };
}

describe("horariosLivresDaOrg — a coleta enxerga o buffer", () => {
  it("⭐ com buffer_before, a janela de coleta é alargada ANTES de `de`", async () => {
    const { client, filtros } = fakeSupabase({
      bufferAntesMin: 30,
      bufferDepoisMin: 0,
      agendamentosNaTabela: [],
    });

    const de = new Date("2026-09-20T13:00:00.000Z");
    const ate = new Date("2026-09-20T14:00:00.000Z");
    await horariosLivresDaOrg(client, ORG, { eventTypeId: TIPO_ID, ownerUserId: DONO, de, ate, agora: de });

    const gt = filtros.find((f) => f.tabela === "calendar_appointments" && f.op === "gt");
    expect(gt?.val, "a coleta não alargou 30 min antes de `de`").toBe(
      new Date(de.getTime() - 30 * 60_000).toISOString(),
    );
  });

  it("⭐ com buffer_after, a janela de coleta é alargada DEPOIS de `ate`", async () => {
    const { client, filtros } = fakeSupabase({
      bufferAntesMin: 0,
      bufferDepoisMin: 15,
      agendamentosNaTabela: [],
    });

    const de = new Date("2026-09-20T13:00:00.000Z");
    const ate = new Date("2026-09-20T14:00:00.000Z");
    await horariosLivresDaOrg(client, ORG, { eventTypeId: TIPO_ID, ownerUserId: DONO, de, ate, agora: de });

    const lt = filtros.find((f) => f.tabela === "calendar_appointments" && f.op === "lt");
    expect(lt?.val, "a coleta não alargou 15 min depois de `ate`").toBe(
      new Date(ate.getTime() + 15 * 60_000).toISOString(),
    );
  });

  it("sem buffer configurado, a janela de coleta continua sendo a crua [de, ate)", async () => {
    const { client, filtros } = fakeSupabase({
      bufferAntesMin: 0,
      bufferDepoisMin: 0,
      agendamentosNaTabela: [],
    });

    const de = new Date("2026-09-20T13:00:00.000Z");
    const ate = new Date("2026-09-20T14:00:00.000Z");
    await horariosLivresDaOrg(client, ORG, { eventTypeId: TIPO_ID, ownerUserId: DONO, de, ate, agora: de });

    const gt = filtros.find((f) => f.tabela === "calendar_appointments" && f.op === "gt");
    const lt = filtros.find((f) => f.tabela === "calendar_appointments" && f.op === "lt");
    expect(gt?.val).toBe(de.toISOString());
    expect(lt?.val).toBe(ate.toISOString());
  });

  it("⭐ ignorarAgendamentoId exclui a própria linha da coleta (remarcação não conflita consigo)", async () => {
    const de = new Date("2026-09-20T14:00:00.000Z");
    const ate = new Date("2026-09-20T15:00:00.000Z");
    // A linha "antiga" do compromisso sendo remarcado: ainda no horário de
    // ORIGEM (13:00-14:00), que cai dentro da janela alargada pelo buffer de
    // 30 min do candidato de destino (14:00-15:00) — sem a exclusão, o próprio
    // compromisso apareceria como vizinho de si mesmo.
    const linhaAntiga = {
      id: "id-do-proprio",
      starts_at: "2026-09-20T13:00:00.000Z",
      ends_at: "2026-09-20T14:00:00.000Z",
      status: "confirmed",
    };
    const { client } = fakeSupabase({
      bufferAntesMin: 30,
      bufferDepoisMin: 0,
      agendamentosNaTabela: [linhaAntiga],
    });

    const semExcluir = await horariosLivresDaOrg(client, ORG, {
      eventTypeId: TIPO_ID,
      ownerUserId: DONO,
      de,
      ate,
      agora: de,
    });
    expect(semExcluir.ok, "não deveria falhar a consulta em si").toBe(true);

    // A prova indireta: o slot exato [de, ate) só aparece na lista de livres
    // quando a própria linha é excluída da coleta.
    const comExcluir = await horariosLivresDaOrg(client, ORG, {
      eventTypeId: TIPO_ID,
      ownerUserId: DONO,
      de,
      ate,
      agora: de,
      ignorarAgendamentoId: "id-do-proprio",
    });
    expect(comExcluir.ok).toBe(true);
    if (comExcluir.ok && semExcluir.ok) {
      const temSlot = (r: typeof comExcluir) => r.slots.some((s) => s.inicio.getTime() === de.getTime());
      expect(temSlot(semExcluir), "sem excluir a si mesmo, o vizinho (que é a própria linha) bloqueou o slot").toBe(
        false,
      );
      expect(temSlot(comExcluir), "excluindo a própria linha, o slot de destino volta a aparecer livre").toBe(true);
    }
  });
});
