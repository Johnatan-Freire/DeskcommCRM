/**
 * Quem pode assumir AGORA, do lado do motor — e a frase que o agente lê.
 *
 * ## O defeito que isto conserta (ACH-03)
 *
 * A capacidade `crm_list_available_attendants` existia, estava ligada e foi
 * montada no turno — e o agente escalou sem chamá-la. Medido num turno real:
 * ele abriu o chamado e disse ao cliente *"vou providenciar para que alguém da
 * equipe entre em contato"*, sem prazo e sem saber se havia alguém para receber.
 *
 * Capacidade que depende de o modelo LEMBRAR de usar é capacidade que não
 * existe metade das vezes. A doutrina do repo é explícita: não confiar na
 * disciplina do modelo para o que o sistema pode garantir. Então o próprio
 * caminho de escalação passa a consultar e a DEVOLVER a expectativa junto com a
 * confirmação — a promessa ao cliente nasce honesta sem ninguém precisar
 * lembrar de nada.
 *
 * ## Por que duplica a consulta de `atendentes.ts`
 *
 * Não duplica a REGRA: a elegibilidade é `isAttendantEligible`, a mesma função
 * pura que o worker de roteamento e a rota do painel usam. O que difere é o
 * CLIENTE — a API fala supabase-js e o motor fala `pg` (roda fora do request).
 * É o mesmo par que `emitLeadActivity` (supabase) e `emitAgentActivityForContact`
 * (pg) formam sobre `buildLeadActivityRow`: dois leitores, uma regra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { isAttendantEligible, isWithinSchedule, OPEN_LOAD_STATUSES } from "@/lib/routing/eligibility";
import { availabilityScheduleSchema, type AvailabilitySchedule } from "@/lib/schemas/routing";
import { proximaAberturaGeral, fraseDaProximaAbertura } from "./proxima-abertura";

import type { Queryable } from "../agent-engine/queue/queue";

export interface QuemPodeAssumir {
  /** Atendentes elegíveis AGORA: disponível ∧ com folga ∧ dentro do horário. */
  disponiveis: number;
  /** Membros agent+ da organização, configurados ou não. */
  total: number;
  /**
   * true quando NENHUM atendente com agenda salva está dentro da PRÓPRIA
   * janela de horário agora (mesmo ignorando capacidade E o toggle
   * `is_available` ao vivo) — ou seja, `disponiveis===0` é efeito de
   * HORÁRIO DECLARADO, não de fila cheia nem de ninguém ter aberto o inbox.
   * Só nesse caso dá pra calcular "volta às Xh" com alguma confiança;
   * capacidade cheia não é previsível daqui (não sabemos quando uma conversa
   * em andamento termina), e "ninguém logado agora" também não é horário —
   * é presença, e cai no genérico de propósito (ver `agendas` abaixo).
   */
  motivoEHorario: boolean;
  /**
   * Agendas de QUEM JÁ CONFIGUROU disponibilidade alguma vez — insumo pra
   * "próxima abertura". Deliberadamente INDEPENDENTE do toggle `is_available`
   * ao vivo (que expira em 15min sem heartbeat, AT-08): a agenda ("seg-sáb
   * 08-12/14-18") é um horário DECLARADO, não uma presença; time pequeno que
   * não fica com o inbox aberto o dia inteiro veria `is_available` quase
   * sempre falso, e a estimativa de horário nunca apareceria se dependesse
   * disso.
   */
  agendas: Pick<AvailabilitySchedule, "timezone" | "windows">[];
}

interface LinhaDeDisponibilidade {
  user_id: string;
  role: string;
  is_available: boolean | null;
  capacity: number | null;
  schedule: unknown;
  /** normalizada pra number nos DOIS leitores antes de chegar aqui (pg devolve string). */
  carga: number;
}

/**
 * A REGRA, compartilhada pelos dois leitores (pg e supabase-js — ver docstring
 * do módulo). Puramente TypeScript: SQL que decidisse elegibilidade aqui seria
 * a segunda regra, e as duas divergiriam sem ninguém notar.
 */
function computeQuemPodeAssumir(rows: LinhaDeDisponibilidade[], now: Date): QuemPodeAssumir {
  // Viewer não é insumo de roteamento — mesmo corte do roster da API.
  const atendentes = rows.filter(
    (r) => ROLE_RANK[r.role as Role] !== undefined && ROLE_RANK[r.role as Role] >= ROLE_RANK.agent,
  );

  // `capacity === null` = nunca salvou uma linha em attendant_availability.
  // is_available NÃO decide se a linha entra aqui — quem configurou uma vez e
  // está offline no momento continua, só com `is_available: false`.
  const configurados = atendentes.filter((r) => r.capacity !== null);

  const agendas = configurados.map((r) => availabilityScheduleSchema.parse(r.schedule ?? {}));

  // `disponiveis` (quem pode assumir DE VERDADE agora) continua exigindo
  // is_available AO VIVO — é o mesmo cálculo que o roteamento usa, e prometer
  // com quem está offline prometeria o que o roteamento nunca entregaria.
  const disponiveis = configurados.filter((r, i) =>
    isAttendantEligible(
      { isAvailable: r.is_available === true, capacity: r.capacity as number, currentLoad: r.carga, schedule: agendas[i] },
      now,
    ),
  ).length;

  // Ignora capacidade E o toggle is_available de propósito (ver doc de
  // `agendas` no módulo): se a AGENDA de alguém diz que está no horário agora
  // (esteja ele logado ou não), o motivo de `disponiveis === 0` não é
  // previsível por horário — pode ser fila cheia ou só ninguém ter aberto o
  // inbox ainda hoje, e prometer "volta às Xh" seria inventar um horário que
  // já passou.
  const motivoEHorario =
    configurados.length > 0 && configurados.every((r, i) => !isWithinSchedule(agendas[i], now));

  return { disponiveis, total: atendentes.length, motivoEHorario, agendas };
}

/**
 * Uma query só: roster agent+ ⟕ disponibilidade ⟕ carga (conversas abertas
 * atribuídas). Cliente `pg` — o motor de turno roda fora do request.
 */
export async function quemPodeAssumirAgora(
  db: Queryable,
  tenantId: string,
  now: Date,
): Promise<QuemPodeAssumir> {
  const { rows } = await db.query<Omit<LinhaDeDisponibilidade, "carga"> & { carga: string }>(
    `select uo.user_id,
            uo.role,
            aa.is_available,
            aa.capacity,
            aa.schedule,
            (select count(*)
               from conversations c
              where c.organization_id = uo.organization_id
                and c.assigned_to_user_id = uo.user_id
                and c.status = any($2::text[])) as carga
       from user_organizations uo
       left join attendant_availability aa
         on aa.organization_id = uo.organization_id
        and aa.user_id = uo.user_id
      where uo.organization_id = $1
        and uo.revoked_at is null`,
    [tenantId, OPEN_LOAD_STATUSES],
  );
  return computeQuemPodeAssumir(
    rows.map((r) => ({ ...r, carga: Number(r.carga) })),
    now,
  );
}

/**
 * Mesma REGRA (computeQuemPodeAssumir), cliente supabase-js — para chamadores
 * que rodam dentro do request (tools MCP, ex.: crm_request_human_handoff) e já
 * têm `ctx.supabase` (admin, bypassa RLS) em vez de um pool `pg` cru. Três
 * queries em vez de um JOIN porque supabase-js não faz subquery correlacionada
 * — mesmo troca-off que `loadEligibleAttendants` (lib/routing/eligibles.ts)
 * já assume para o mesmo tipo de leitura.
 */
export async function quemPodeAssumirAgoraViaSupabase(
  supabase: SupabaseClient,
  tenantId: string,
  now: Date,
): Promise<QuemPodeAssumir> {
  const { data: roster, error: rosterErr } = await supabase
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", tenantId)
    .is("revoked_at", null);
  if (rosterErr) throw new Error(rosterErr.message);

  const { data: avail, error: availErr } = await supabase
    .from("attendant_availability")
    .select("user_id, is_available, capacity, schedule")
    .eq("organization_id", tenantId);
  if (availErr) throw new Error(availErr.message);

  const availByUser = new Map(
    ((avail ?? []) as { user_id: string; is_available: boolean | null; capacity: number | null; schedule: unknown }[]).map(
      (a) => [a.user_id, a],
    ),
  );

  const userIds = ((roster ?? []) as { user_id: string; role: string }[]).map((r) => r.user_id);
  const loadByUser = new Map<string, number>();
  if (userIds.length > 0) {
    const { data: openConvs, error: convErr } = await supabase
      .from("conversations")
      .select("assigned_to_user_id")
      .eq("organization_id", tenantId)
      .in("assigned_to_user_id", userIds)
      .in("status", OPEN_LOAD_STATUSES as unknown as string[]);
    if (convErr) throw new Error(convErr.message);
    for (const c of (openConvs ?? []) as { assigned_to_user_id: string | null }[]) {
      if (c.assigned_to_user_id) {
        loadByUser.set(c.assigned_to_user_id, (loadByUser.get(c.assigned_to_user_id) ?? 0) + 1);
      }
    }
  }

  const rows: LinhaDeDisponibilidade[] = ((roster ?? []) as { user_id: string; role: string }[]).map((r) => {
    const a = availByUser.get(r.user_id);
    return {
      user_id: r.user_id,
      role: r.role,
      is_available: a?.is_available ?? null,
      capacity: a?.capacity ?? null,
      schedule: a?.schedule ?? null,
      carga: loadByUser.get(r.user_id) ?? 0,
    };
  });

  return computeQuemPodeAssumir(rows, now);
}

/**
 * A frase que vai para o MODELO junto com a confirmação da escalação.
 *
 * Pura e separada da leitura porque é ela que decide o que o cliente ouve — e
 * comparar frase é barato, comparar linha de banco é caro.
 *
 * Os casos são diferentes de propósito. O da instalação fresca (`total===0`):
 * numa VPS recém-instalada NINGUÉM está em `attendant_availability`, e sem
 * esta frase o agente prometeria contato para o vazio na primeira conversa do
 * cliente — a pior primeira impressão possível num produto self-host.
 *
 * `now`/`timezone` só entram para calcular a "próxima abertura" quando o
 * motivo de `disponiveis===0` é HORÁRIO (`motivoEHorario`) — pedido do dono do
 * produto: se o handoff cai no almoço ou fora de expediente, o cliente ouve
 * uma estimativa de verdade ("volta às 14h"), não só "assim que possível".
 */
export function fraseDeExpectativa(
  q: QuemPodeAssumir,
  now: Date,
  timezone: string = "America/Sao_Paulo",
): string {
  if (q.total === 0) {
    return (
      "ATENÇÃO: esta conta ainda não tem ninguém configurado para receber atendimento. " +
      "NÃO prometa que alguém entra em contato — diga que o pedido ficou registrado e que " +
      "a equipe responde assim que possível."
    );
  }
  if (q.disponiveis === 0) {
    if (q.motivoEHorario) {
      const proxima = proximaAberturaGeral(q.agendas, now);
      if (proxima) return fraseDaProximaAbertura(proxima, now, timezone);
    }
    return (
      "ATENÇÃO: não há ninguém da equipe disponível neste momento. NÃO prometa contato " +
      "imediato nem dê prazo curto — diga que o pedido ficou registrado e que a equipe " +
      "retorna assim que possível."
    );
  }
  const pessoas = q.disponiveis === 1 ? "1 pessoa" : `${q.disponiveis} pessoas`;
  return `Há ${pessoas} da equipe podendo assumir agora — pode dizer ao cliente que alguém continua o atendimento em seguida.`;
}

/**
 * Leitura + frase, com rede de segurança.
 *
 * Falha de leitura NÃO pode derrubar a escalação (o cliente está esperando), e
 * também não pode virar silêncio otimista: sem o dado, o agente recebe a
 * instrução conservadora — não prometer prazo. Errar para o lado de prometer
 * menos é recuperável; prometer o que não se cumpre, não.
 */
export async function expectativaDeAtendimento(
  db: Queryable,
  tenantId: string,
  now: Date,
  timezone?: string,
): Promise<{ quem: QuemPodeAssumir | null; frase: string }> {
  try {
    const quem = await quemPodeAssumirAgora(db, tenantId, now);
    return { quem, frase: fraseDeExpectativa(quem, now, timezone) };
  } catch {
    return {
      quem: null,
      frase:
        "Não foi possível confirmar quem está disponível agora. NÃO prometa contato imediato " +
        "nem dê prazo — diga que o pedido ficou registrado.",
    };
  }
}
