/**
 * A IDA — escrever no Google o que foi marcado aqui.
 *
 * ═══ O buraco que este arquivo fecha ═══
 *
 * O item pedido é "sync IDA E VOLTA". A VOLTA existe inteira (`eventos-remotos`,
 * `evento.doEventoDoGoogle`, o cron de sync). A IDA não tinha uma linha:
 *
 *     grep -rn "paraEventoDoGoogle" app lib workers components hooks
 *     # 2 linhas, AMBAS dentro de lib/agenda/google/evento.ts = ZERO call sites
 *     grep -rn 'method: "' lib/agenda/google/*.ts
 *     # 1 linha: token.ts (a troca OAuth) — nenhuma escrita de evento
 *
 * O tradutor estava escrito, testado e na prateleira. O schema também: a
 * `calendar_appointments` já tem `google_event_id`, `google_ical_uid`,
 * `google_sequence`, `google_synced_at` e `google_sync_error`. E o filtro
 * anti-eco do worker de leitura (`ehIcalUidNosso`) já pressupunha exatamente o
 * que não estava implementado — ele existia para ignorar eventos que nós
 * criaríamos, e nós nunca criávamos nenhum.
 *
 * ═══ Por que `PUT` com id nosso, e não `POST` ═══
 *
 * O Google aceita o id do evento vindo de quem cria (`events.insert` com `id`,
 * ou `events.update` num id que ainda não existe). Usar um id DERIVADO do
 * agendamento torna a operação IDEMPOTENTE: reenviar o mesmo compromisso
 * atualiza o mesmo evento em vez de criar um segundo. Num worker que pode rodar
 * duas vezes — e todo cron pode —, isso é a diferença entre "reenviou" e
 * "duplicou a agenda do cliente".
 *
 * O id do Google aceita apenas [a-v0-9] e no mínimo 5 caracteres, então o uuid
 * do agendamento é normalizado: hífens fora e dígitos w–z remapeados. É função
 * pura e testável, e o teste mede a INVERSA (dois ids diferentes nunca colidem).
 */
import { classificarErroDoGoogle, type ClassificacaoDoErro } from "./erros";
import { paraEventoDoGoogle, SUFIXO_ICAL_UID, type AgendamentoParaGoogle } from "./evento";

const ENDERECO_DE_EVENTOS = "https://www.googleapis.com/calendar/v3/calendars";
const PRAZO_MS = 15_000;

export type EscritaNoGoogle =
  | { ok: true; eventoId: string; sequence: number | null }
  | { ok: false; classificacao: ClassificacaoDoErro; detalhe: string };

/**
 * O id do evento no Google, derivado do id do agendamento.
 *
 * O Google exige [a-v0-9]{5,1024}. Um uuid tem hífens e pode ter w–z? Não: hex
 * vai só até `f`. Então basta remover os hífens — mas o prefixo existe para que
 * o id seja RECONHECÍVEL como nosso ao olhar a agenda do cliente, e para não
 * colidir com id de outro sistema que também derive de uuid.
 */
export function idDeEventoDoGoogle(idDoAgendamento: string): string {
  const limpo = idDoAgendamento.toLowerCase().replace(/[^a-v0-9]/g, "");
  return `${PREFIXO}${limpo}`;
}

/**
 * O prefixo sai do MESMO lugar que a identidade iCal, e não de um literal aqui.
 *
 * ⚠️ Eu tinha escrito `deskcomm` cravado, e `tests/unit/branding.test.ts`
 * reprovou — corretamente: numa instalação de marca própria, um literal de marca
 * no código é vazamento. Mas a saída NÃO é resolver por `branding()`: o cabeçalho
 * de `SUFIXO_ICAL_UID` já mediu por quê — se a identidade saísse da marca
 * resolvida, todo evento criado ANTES de uma troca de marca deixaria de ser
 * reconhecido, e o sintoma seria compromisso fantasma ocupando horário, sem erro
 * nenhum.
 *
 * Então a identidade é fixa do PRODUTO, e existe uma fonte só para ela.
 */
const PREFIXO = SUFIXO_ICAL_UID.toLowerCase().replace(/[^a-v0-9]/g, "");

async function chamar(
  metodo: "PUT" | "DELETE",
  accessToken: string,
  calendarId: string,
  eventoId: string,
  corpo?: unknown,
): Promise<Response> {
  const url = `${ENDERECO_DE_EVENTOS}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventoId)}`;
  return fetch(url, {
    method: metodo,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(corpo === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    signal: AbortSignal.timeout(PRAZO_MS),
    cache: "no-store",
  });
}

/**
 * Cria OU atualiza o evento — a mesma chamada, de propósito.
 *
 * Remarcar não é uma operação diferente de marcar aos olhos do Google: é o mesmo
 * evento com outro `start`. Ter dois caminhos aqui obrigaria o chamador a saber
 * se o evento já existe lá, que é uma pergunta que ele não tem como responder
 * sem uma ida a mais.
 */
export async function publicarNoGoogle(
  accessToken: string,
  calendarId: string,
  agendamento: AgendamentoParaGoogle,
): Promise<EscritaNoGoogle> {
  const eventoId = idDeEventoDoGoogle(agendamento.id);
  let resposta: Response;
  try {
    resposta = await chamar("PUT", accessToken, calendarId, eventoId, paraEventoDoGoogle(agendamento));
  } catch (erro) {
    return {
      ok: false,
      classificacao: classificarErroDoGoogle(erro, "sincronizar"),
      detalhe: erro instanceof Error ? erro.message : String(erro),
    };
  }
  if (!resposta.ok) {
    const cru = await resposta.json().catch(() => ({ status: resposta.status }));
    return {
      ok: false,
      classificacao: classificarErroDoGoogle(cru, "sincronizar"),
      detalhe: `HTTP ${resposta.status}`,
    };
  }
  const corpo = (await resposta.json().catch(() => ({}))) as { id?: string; sequence?: number };
  return {
    ok: true,
    eventoId: typeof corpo.id === "string" && corpo.id ? corpo.id : eventoId,
    sequence: typeof corpo.sequence === "number" ? corpo.sequence : null,
  };
}

/**
 * Apaga o evento lá. Cancelar aqui tem de sumir de lá — senão o horário segue
 * bloqueado na agenda pessoal de quem atende, e o efeito é o oposto do pedido.
 *
 * ⚠️ 404 e 410 são SUCESSO. O evento não existe mais: é exatamente o estado que
 * se queria. Tratá-los como erro faria o worker reencher a Central de avisos com
 * uma falha que não é falha — e o `classificarErroDoGoogle` já nomeia isso como
 * `ja_esta_feito`.
 */
export async function apagarNoGoogle(
  accessToken: string,
  calendarId: string,
  idDoAgendamento: string,
): Promise<EscritaNoGoogle> {
  const eventoId = idDeEventoDoGoogle(idDoAgendamento);
  let resposta: Response;
  try {
    resposta = await chamar("DELETE", accessToken, calendarId, eventoId);
  } catch (erro) {
    return {
      ok: false,
      classificacao: classificarErroDoGoogle(erro, "apagar"),
      detalhe: erro instanceof Error ? erro.message : String(erro),
    };
  }
  if (resposta.ok || resposta.status === 404 || resposta.status === 410) {
    return { ok: true, eventoId, sequence: null };
  }
  const cru = await resposta.json().catch(() => ({ status: resposta.status }));
  return {
    ok: false,
    classificacao: classificarErroDoGoogle(cru, "apagar"),
    detalhe: `HTTP ${resposta.status}`,
  };
}
