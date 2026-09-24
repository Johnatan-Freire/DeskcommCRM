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
   *
   * Opcional: `lib/ai/handoff/aviso-ao-lead.ts` monta este tipo pelo lado
   * supabase-js (roster de `atendentes.ts`, sem leitura de agenda) para
   * `textoDoAviso` — esse consumidor não usa "próxima abertura", então não
   * precisa calcular o campo. Ausente é lido como "não é motivo de horário".
   */
  motivoEHorario?: boolean;
  /**
   * Agendas de QUEM JÁ CONFIGUROU disponibilidade alguma vez — insumo pra
   * "próxima abertura". Deliberadamente INDEPENDENTE do toggle `is_available`
   * ao vivo (que expira em 15min sem heartbeat, AT-08): a agenda ("seg-sáb
   * 08-12/14-18") é um horário DECLARADO, não uma presença; time pequeno que
   * não fica com o inbox aberto o dia inteiro veria `is_available` quase
   * sempre falso, e a estimativa de horário nunca apareceria se dependesse
   * disso.
   */
  agendas?: Pick<AvailabilitySchedule, "timezone" | "windows">[];
}

interface LinhaDeDisponibilidade {
  user_id: string;
  role: string;
  is_available: boolean | null;
  capacity: number | null;
  schedule: unknown;
  carga: string;
}

/**
 * Uma query só: roster agent+ ⟕ disponibilidade ⟕ carga (conversas abertas
 * atribuídas). A decisão de elegibilidade fica em TypeScript, na função pura
 * compartilhada — SQL que decidisse aqui seria a segunda regra.
 */
export async function quemPodeAssumirAgora(
  db: Queryable,
  tenantId: string,
  now: Date,
): Promise<QuemPodeAssumir> {
  const { rows } = await db.query<LinhaDeDisponibilidade>(
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

  // Viewer não é insumo de roteamento — mesmo corte do roster da API.
  const atendentes = rows.filter(
    (r) => ROLE_RANK[r.role as Role] !== undefined && ROLE_RANK[r.role as Role] >= ROLE_RANK.agent,
  );

  // `capacity === null` = nunca salvou uma linha em attendant_availability
  // (o LEFT JOIN não deu match nenhum). Agora is_available NÃO faz parte da
  // condição do join — quem configurou uma vez e está offline no momento
  // continua aqui, com a linha, só com `is_available: false`.
  const configurados = atendentes.filter((r) => r.capacity !== null);

  const agendas = configurados.map((r) => availabilityScheduleSchema.parse(r.schedule ?? {}));

  // `disponiveis` (quem pode assumir DE VERDADE agora) continua exigindo
  // is_available AO VIVO — é o mesmo cálculo que o roteamento usa, e prometer
  // com quem está offline prometeria o que o roteamento nunca entregaria.
  const disponiveis = configurados.filter((r, i) =>
    isAttendantEligible(
      { isAvailable: r.is_available === true, capacity: r.capacity as number, currentLoad: Number(r.carga), schedule: agendas[i]! },
      now,
    ),
  ).length;

  // Ignora capacidade E o toggle is_available de propósito (ver doc de
  // `agendas` acima): se a AGENDA de alguém diz que está no horário agora
  // (esteja ele logado ou não), o motivo de `disponiveis === 0` não é
  // previsível por horário — pode ser fila cheia ou só ninguém ter aberto o
  // inbox ainda hoje, e prometer "volta às Xh" seria inventar um horário que
  // já passou.
  const motivoEHorario =
    configurados.length > 0 && configurados.every((r, i) => !isWithinSchedule(agendas[i]!, now));

  return { disponiveis, total: atendentes.length, motivoEHorario, agendas };
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
    if (q.motivoEHorario && q.agendas) {
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
