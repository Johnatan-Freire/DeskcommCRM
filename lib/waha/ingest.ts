/**
 * lib/waha/ingest.ts — pipeline de ingestão WAHA compartilhado pelos dois route
 * handlers de webhook (`/waha` global e `/waha/[token]` per-tenant).
 *
 * Fonte única da verdade para: parse de identidade WhatsApp, resolução de
 * contato/conversa e persistência de mensagem. Resolução é ATÔMICA via RPC
 * (fn_upsert_wa_contact / fn_upsert_wa_conversation) — o padrão check-then-act
 * antigo criava um contato/conversa novo a cada mensagem porque o WAHA NOWEB
 * emite `message` E `message.any` para a mesma mensagem (corrida). Ver migration
 * 0027 para o modelo de identidade canônica.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { lancarFalhaDeIngestao } from "@/lib/waha/falha-transitoria";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { sincronizarSaudeDaConexao } from "@/lib/channels/health";
import { marcarConversaComMensagem } from "@/lib/channels/marcar-conversa";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import {
  MOTIVO_COMANDO_OFF,
  pausarIaDuravelmente,
  pausarIaPorAtendimentoManual,
} from "@/lib/escalacao/atendimento-manual";
import { agenteAceitaComandoDeCelular, lerComandoDeControle } from "@/lib/escalacao/comando-de-canal";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import { getWahaClient } from "@/lib/waha/client";
import { acelerarPipelineDeEventos } from "@/lib/dev/kick-local-pipeline";
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { estamparAtribuicaoDoContato } from "@/lib/leads/atribuicao-de-anuncio";
import { extrairEEstamparAtribuicaoGoogle } from "@/lib/plataformas-de-anuncio/google/atribuicao";
import { extrairAtribuicaoWaha } from "@/lib/waha/atribuicao-de-anuncio";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ackToStatus } from "@/lib/types/messaging";
import type { WahaEnvelope, WahaPayload } from "@/lib/waha/envelope";
import {
  bodyOf,
  dataDoTimestamp,
  ehEnderecavel,
  mediaMimeOf,
  mediaUrlOf,
  notifyNameOf,
  parseChatId,
  resolveMessageType,
  telefoneAlternativoDe,
  type ChatIdentity,
} from "@/lib/waha/payload";
import { bareWaMessageId, chatIdFromWaMessageId } from "@/lib/waha/message-id";
import { logger } from "@/lib/logger";
import {
  ehNumeroInternoDeAviso,
  registrarMensagemIgnorada,
} from "@/lib/escalacao/numero-interno-de-aviso";

export type Admin = ReturnType<typeof createAdminClient>;

/**
 * A pausa da IA quando uma pessoa responde pelo celular vive em
 * `lib/escalacao/atendimento-manual.ts` (`pausarIaPorAtendimentoManual`), e não
 * mais aqui. Era `silenciarBotPorRetomadaHumana`, exclusiva deste arquivo e do
 * WhatsApp; o gesto é o mesmo em qualquer canal (o Zernio tem o mesmo caminho de
 * saída-por-fora-do-CRM), e duas encarnações da mesma regra divergiriam na
 * primeira vez que alguém mexesse numa só. O helper unificado mantém o que esta
 * função garantia — prazo que expira sozinho, renovado a cada fala humana, e
 * silêncio maior NUNCA encurtado — e acrescenta o rastro de handoff.
 *
 * Os comandos `#on`/`#off` também entram por aqui, em
 * `handleOutboundFromUserPhone`, SÓ para o agente que ligou "Comandos pelo
 * celular": são lidos por `lerComandoDeControle` e escondidos do cliente com
 * `revogarComando`.
 */

/**
 * Quanto tempo um envio nosso pode ficar "em voo" antes de o eco deixar de ser
 * explicável por ele.
 *
 * 60s é folgado de propósito: o custo de errar para o lado permissivo é uma
 * digitação real do celular não silenciar a IA por um minuto; o custo de errar
 * para o outro lado é a IA muda por três horas. Os dois erros não são simétricos.
 */
const JANELA_DO_ECO_MS = 60_000;

/**
 * A mensagem `fromMe` que chegou é o eco de um envio que ESTE CRM acabou de
 * fazer — e não alguém digitando no celular?
 *
 * A prova exigida é forte: uma linha nossa na MESMA conversa, ainda sem
 * `external_id` (portanto ainda em voo), com o MESMO corpo, dentro da janela.
 * Qualquer uma dessas faltando, a resposta é "não sei" — e "não sei" silencia,
 * porque é o desfecho seguro do lado do atendente humano (#371).
 *
 * Mídia não tem corpo comparável (o eco traz `media_url`, não texto): ali a
 * prova cai para "existe envio nosso em voo do mesmo tipo na janela", que é mais
 * permissivo e assumidamente mais fraco.
 */
async function ehEcoDeEnvioNosso(
  admin: Admin,
  organizationId: string,
  conversationId: string,
  p: WahaPayload,
): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_DO_ECO_MS).toISOString();
  const { data, error } = await admin
    .from("messages")
    .select("id, body, type")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    // `sent_via` separa o que NASCEU aqui do que veio do celular: a linha do
    // celular é gravada como `external_device` e nunca pode servir de álibi.
    //
    // `automation` entrou junto do carimbo novo (#652). A mensagem que a REGRA
    // manda nasceu aqui tanto quanto a da IA e a do composer; sem ela nesta
    // lista, o eco do próprio envio da regra era lido como resposta pelo celular
    // e a IA ficava pausada na conversa por causa de uma mensagem que o CRM
    // mandou sozinho. Lista e carimbo andam juntos: quem escreve estes valores é
    // `origemDaMensagem`, em `app/api/v1/messages/_handler.ts`.
    //
    // `system` ENTRA pela mesma razão, e o sintoma seria idêntico: é o valor que
    // o envio por TOKEN DE SERVIDOR grava (#866). Fora desta lista, a linha da
    // integração deixa de ser reconhecida como envio NOSSO, o eco do próprio
    // envio vira "resposta pelo celular" e cala a IA por três horas.
    .in("sent_via", ["ai", "user", "automation", "system"])
    // Sem `external_id` = ainda não confirmada pelo canal = ainda em voo. É esta
    // a janela exata em que o eco é indistinguível de digitação humana.
    .is("external_id", null)
    .in("status", ["queued", "sending"])
    .gte("created_at", desde)
    .limit(20);

  if (error) {
    // Falha de leitura não pode virar "é eco": na dúvida, silencia — o
    // desfecho seguro é o do atendente humano.
    console.error("[waha.ingest] checagem de eco falhou", error.message);
    return false;
  }

  const corpo = (p.body ?? "").trim();
  for (const linha of data ?? []) {
    const l = linha as { body: string | null; type?: string | null };
    if (p.type && p.type !== "chat") {
      // Mídia: sem corpo para comparar, a existência do envio em voo é a prova
      // possível. Mais fraco, e escrito para ninguém supor o contrário.
      if ((l.type ?? "chat") !== "chat") return true;
      continue;
    }
    if (corpo.length > 0 && (l.body ?? "").trim() === corpo) return true;
  }
  return false;
}

interface Session {
  id: string;
  organization_id: string;
  /**
   * Nome da sessão no WAHA. Só é usado para chamar o transporte de volta (ex.:
   * revogar o comando `#on`/`#off`). Opcional porque há chamadas sintéticas
   * (testes, caminhos internos) que não passam por uma linha de `channel_sessions`.
   */
  waha_session_name?: string | null;
}

/**
 * O formato do fio mora em `lib/waha/envelope.ts`, onde é um schema Zod — e o
 * tipo NASCE dele (`z.infer`). Re-exportado aqui porque este módulo era o dono
 * do tipo e quem já o importava não precisa saber que ele mudou de casa.
 */
export type { WahaEnvelope, WahaPayload } from "@/lib/waha/envelope";

export type { ChatIdentity } from "@/lib/waha/payload";
export {
  dataDoTimestamp,
  mediaMimeOf,
  mediaUrlOf,
  parseChatId,
  resolveMessageType,
  telefoneAlternativoDe,
} from "@/lib/waha/payload";

/**
 * O SUFIXO responde "que formato é este?"; o resto identifica uma pessoa.
 *
 * Registro operacional não é cópia de dado de contato — mesma linha de
 * `markConversation`, que deliberadamente não copia o texto da mensagem. Sem
 * isso, o log de diagnóstico vira depósito de número de telefone.
 */
function sufixoDeChatId(chatId: string): string {
  const at = chatId.lastIndexOf("@");
  if (at !== -1) return chatId.slice(at);
  return chatId === "" ? "(vazio)" : "(sem @)";
}

/**
 * Um chatId que não sabemos endereçar é ANOMALIA — tem que ser contável.
 *
 * `select count(*) from event_log where event_type = 'whatsapp.chat_id_not_recognized'`
 * responde "o WhatsApp mudou de formato e estamos perdendo mensagem?", que antes
 * não tinha como ser respondido: o descarte não deixava nada para trás.
 */
async function avisarChatNaoReconhecido(
  admin: Admin,
  organizationId: string,
  sessionId: string,
  chatId: string,
  direction: "inbound" | "outbound",
): Promise<void> {
  const { error } = await admin.rpc("emit_event" as never, {
    p_event_type: "whatsapp.chat_id_not_recognized",
    p_entity_kind: "channel_session",
    p_entity_id: sessionId,
    p_payload: { sufixo: sufixoDeChatId(chatId), direction },
    p_metadata: { severity: "warn" },
    p_organization_id: organizationId,
  } as never);
  if (error) {
    console.error("[waha.ingest] o aviso de chat não reconhecido também falhou", error.message);
  }
}


export function verifyHmacSha512(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const got = signatureHeader.replace(/^sha512=/i, "").trim();
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function previewFromMessage(p: WahaPayload): string {
  if (p.body) return p.body.slice(0, 280);
  const t = resolveMessageType(p);
  return t !== "text" ? `[${t}]` : "";
}


/**
 * Upsert atômico de contato pela identidade canônica. Retorna null se a
 * identidade for de grupo ou a RPC falhar.
 */
async function upsertContact(
  admin: Admin,
  orgId: string,
  parsed: ChatIdentity,
  chatId: string,
  notifyName: string | null,
  telefoneAlt: string | null = null,
): Promise<string | null> {
  // ALLOWLIST, não denylist — e a diferença aqui não é estilo.
  //
  // `fn_upsert_wa_contact` NÃO valida `p_kind`, e `contacts.wa_identity` é coluna
  // GERADA que só produz `phone:`/`lid:`; qualquer outro kind a deixa NULL. Como
  // o `on conflict` da RPC é `(organization_id, wa_identity) where wa_identity is
  // not null`, uma linha NULL nunca conflita — nasceria UM CONTATO NOVO A CADA
  // WEBHOOK, que é exatamente o anti-pattern que a migration 0027 veio matar.
  //
  // Com `kind === "group"` (a forma antiga), acrescentar uma variante à união
  // abria esse buraco em silêncio: o TS não reclama de um `===` que deixou de
  // cobrir todos os casos. Perguntar quem PODE passar falha fechado sozinho.
  //
  // ⚠️ SEGUNDA CAMADA, SEM COBERTURA POSSÍVEL — e isto está escrito porque medi:
  // trocar esta linha de volta pela denylist deixa a suíte inteira VERDE (35/35,
  // typecheck 0). Os dois chamadores já barram o não-endereçável antes de chegar
  // aqui, então nenhum teste consegue alcançá-la; é defesa em profundidade na
  // fronteira com uma RPC que não valida nada. Quem mexer aqui não vai ser
  // avisado por teste nenhum — só por este comentário.
  if (!ehEnderecavel(parsed)) return null;
  const { data, error } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: orgId,
    p_kind: parsed.kind,
    // O telefone vem de dois lugares e é UM parâmetro: do próprio chatId quando
    // ele já é um número, ou de `_data.key.remoteJidAlt` quando o chat é `@lid`.
    // Resolver aqui, e não no SQL, foi o que permitiu manter a assinatura da
    // função (e portanto os grants e os invariantes de hardening) intacta.
    p_phone: parsed.kind === "phone"
      ? canonicalPhoneBR(parsed.phone)
      : telefoneAlt
        ? canonicalPhoneBR(telefoneAlt)
        : null,
    p_lid: parsed.kind === "lid" ? parsed.lid : null,
    p_chat_id: chatId,
    p_notify: notifyName,
  } as never);
  if (error) {
    lancarFalhaDeIngestao("fn_upsert_wa_contact", error);
  }
  return (data as string) ?? null;
}

async function upsertConversation(
  admin: Admin,
  orgId: string,
  contactId: string,
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation" as never, {
    p_org: orgId,
    p_contact: contactId,
    p_session: sessionId,
  } as never);
  if (error) {
    lancarFalhaDeIngestao("fn_upsert_wa_conversation", error);
  }
  return (data as string) ?? null;
}

/**
 * Carimba a conversa com a mensagem que acabou de entrar.
 *
 * ⚠️ FALHA BAIXO, MAS CONTA — e a diferença entre as duas coisas é o motivo
 * desta função existir com corpo próprio. A mensagem JÁ foi inserida quando
 * chegamos aqui; bloquear a ingestão porque o carimbo falhou deixaria o
 * histórico refém de uma coluna derivada. Então não se bloqueia.
 *
 * Mas `console.error` sozinho não é "falhar baixo": ele **não bloqueia e também
 * não conta** (anti-pattern nº 14 do CLAUDE.md, e a mesma doutrina já escrita em
 * `lib/leads/activity-write-failure.ts`). Log de servidor sem destino não vira
 * alerta de ninguém — e o efeito prático é que "a RPC falha às vezes" nunca sai
 * de OPINIÃO para NÚMERO. Em 25/07 isso custou caro: a suspeita de que esta
 * chamada falhava foi levada a sério por horas, e não havia como medi-la porque
 * cada falha tinha sumido no log de um processo que já não existia.
 *
 * O evento é o que torna a pergunta respondível: `select count(*) from event_log
 * where event_type = 'whatsapp.conversation_mark_failed'`.
 *
 * ⚠️ O CORPO MUDOU DE CASA, e o motivo está em `lib/channels/marcar-conversa.ts`:
 * Meta e Zernio chamavam a mesma RPC e tratavam a falha pior — a Meta ignorava
 * o retorno inteiro. Esta função continua existindo com a assinatura que os dois
 * chamadores daqui usam; quem decide o que fazer com a falha é uma só.
 */
async function markConversation(
  admin: Admin,
  organizationId: string,
  convId: string,
  direction: "inbound" | "outbound",
  preview: string,
  at: string,
): Promise<void> {
  await marcarConversaComMensagem(admin as unknown as SupabaseClient, {
    organizationId,
    conversationId: convId,
    direction,
    preview,
    at,
    canal: "waha",
  });
}

/**
 * Mensagem recebida (fromMe=false). Contato = remetente (`from`).
 */
async function mensagemIngeridaPorExternalId(
  admin: Admin,
  orgId: string,
  externalId: string,
): Promise<{ id: string; contact_id: string; body: string | null } | null> {
  const { data, error } = await admin
    .from("messages")
    .select("id, contact_id, body")
    .eq("organization_id", orgId)
    .eq("external_id", externalId)
    .eq("direction", "inbound")
    .maybeSingle();
  if (error) {
    logger.warn("waha.ingest: dedup sem ler mensagem existente", { detail: error.message });
    return null;
  }
  return data ?? null;
}

async function handleInbound(
  admin: Admin,
  session: Session,
  p: WahaPayload,
  requestId: string,
): Promise<void> {
  const chatId = p.from ?? "";
  const parsed = parseChatId(chatId);
  if (parsed.kind === "group") return; // grupos não fazem binding CRM
  if (!p.id) return;
  // WAHA emite eventos vazios p/ status/read-receipt/presence — não viram mensagem.
  const texto = bodyOf(p);
  if (!texto && !mediaUrlOf(p) && !p.hasMedia) return;
  // Daqui para baixo era para ser uma mensagem de verdade: se o chat não é
  // endereçável, PERDEMOS uma — e isso precisa ser contável. O aviso fica depois
  // das guardas acima de propósito; antes delas, todo evento de presença viraria
  // um registro, e log que enche sozinho é log que ninguém lê.
  if (!ehEnderecavel(parsed)) {
    await avisarChatNaoReconhecido(admin, session.organization_id, session.id, chatId, "inbound");
    return;
  }

  // ── O NÚMERO INTERNO DE AVISOS NÃO VIRA ATENDIMENTO ─────────────────────
  //
  // Aqui, e não em `pos-entrada`: é o INSERT da conversa (logo abaixo) que
  // dispara o pedido de rodízio pelo banco. Cortar depois já teria criado
  // contato, conversa e uma "conversa do suporte" na fila de um atendente — e o
  // "cancelar" que alguém da equipe digitasse bloquearia esse contato.
  if (await ehNumeroInternoDeAviso(admin, session.organization_id, parsed)) {
    await registrarMensagemIgnorada(admin, session.organization_id, {
      direction: "inbound",
      sessionId: session.id,
    });
    return;
  }

  const contactId = await upsertContact(
    admin,
    session.organization_id,
    parsed,
    chatId,
    notifyNameOf(p),
    telefoneAlternativoDe(p),
  );
  if (!contactId) return;

  // Best-effort: o dado do anúncio (se houver) vai embutido na PRÓPRIA
  // mensagem que o app do cliente manda ao clicar num anúncio "Clique para o
  // WhatsApp" — não é exclusivo da API oficial. O WAHA NOWEB pode entregar
  // `externalAdReply`; formas não reconhecidas seguem silenciosas e nunca
  // derrubam o inbound.
  // `estamparAtribuicaoDoContato` só grava na primeira vez — se o
  // contato já tem atribuição, o UPDATE casa zero linhas.
  const atribuicao = extrairAtribuicaoWaha(p._data?.message);
  if (atribuicao) await estamparAtribuicaoDoContato(admin, session.organization_id, contactId, atribuicao);

  // Irmão do bloco acima, para o Google: o token vem no PRÓPRIO texto da
  // mensagem (não há payload de ad-reply equivalente para essa plataforma) —
  // ver o cabeçalho de `lib/plataformas-de-anuncio/google/atribuicao.ts`. Best-effort.
  await extrairEEstamparAtribuicaoGoogle(admin, session.organization_id, contactId, texto);

  const conversationId = await upsertConversation(admin, session.organization_id, contactId, session.id);
  if (!conversationId) return;

  const now = new Date().toISOString();
  const { data: insertedMessage, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      contact_id: contactId,
      external_id: p.id,
      type: resolveMessageType(p),
      direction: "inbound",
      status: "delivered",
      ack: p.ack ?? null,
      body: texto,
      media_url: mediaUrlOf(p),
      media_mime: mediaMimeOf(p),
      sent_via: "external_device",
      sent_at: dataDoTimestamp(p.timestamp, now),
      delivered_at: now,
      metadata: { raw_type: p.type, ack_name: p.ackName },
    })
    .select("id")
    .maybeSingle();

  // Idempotência: 23505 = unique (organization_id, external_id) já ingerido.
  if (insertErr && insertErr.code !== "23505") {
    // Era `console.error` + `return`, e a rota devolvia 200: a mensagem do
    // cliente sumia. Agora lança — transitória vira 503 (o WAHA reentrega) e
    // fica marcada para o cron `webhook-replay`. Ver `falha-transitoria.ts`.
    lancarFalhaDeIngestao("messages.insert inbound", insertErr);
  }
  if (insertErr?.code === "23505") {
    // O `return` está certo — reingerir duplicaria a mensagem do cliente. Mas
    // sair MUDO era o defeito: "5 mensagens, 4 jobs" fica indistinguível entre
    // dedup legítimo e mensagem perdida por outro caminho, e a pergunta "cadê o
    // turno dessa?" passa a não ter resposta no log.
    //
    // Não é erro, é evento esperado — por isso `info` e não `error`. O que ele
    // paga é a CONTAGEM: sem a linha, o silêncio de um dedup normal e o de uma
    // perda têm a mesma cara.
    logger.info("waha.ingest: inbound ja ingerido, dedup por external_id", {
      organization_id: session.organization_id,
      conversation_id: conversationId,
      external_id: p.id,
      direcao: "inbound",
    });
    // A 1ª entrega pode ter gravado a mensagem e estourado o tempo ANTES de
    // `aplicarEfeitosPosEntrada` — a reentrega cai aqui. Reacelerar só o
    // pipeline (sem re-despachar o agente) destrava o match_reply.
    const existente = await mensagemIngeridaPorExternalId(admin, session.organization_id, p.id);
    if (existente) {
      try {
        await acelerarPipelineDeEventos(admin, {
          organizationId: session.organization_id,
          contactId: existente.contact_id,
          messageId: existente.id,
          texto: existente.body,
        });
      } catch (err) {
        logger.warn("waha.ingest: dedup nao reacelerou pipeline", {
          organization_id: session.organization_id,
          external_id: p.id,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return;
  }

  await markConversation(admin, session.organization_id, conversationId, "inbound", previewFromMessage(p), dataDoTimestamp(p.timestamp, now));

  await audit({
    action: "message.received",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: { conversation_id: conversationId, type: p.type, external_id: p.id },
  });

  // ── OS EFEITOS DE NEGÓCIO, agora ATRÁS DO SEAM ──────────────────────────────
  //
  // Opt-out, nascimento do lead e despacho do agente moravam AQUI DENTRO, em
  // linha. Enquanto este era o único canal isso não incomodava; quando entrou o
  // número oficial, ele passou a gravar a mensagem e não fazer nenhum dos três —
  // sem erro e sem log. Medido: 806 despachos deste lado, 0 do outro.
  //
  // A ordem dos três é regra de negócio e está documentada em
  // `lib/channels/pos-entrada.ts`, junto com o motivo de cada posição. O
  // comportamento aqui é o MESMO de antes, campo a campo — o que mudou é quem o
  // executa.
  await aplicarEfeitosPosEntrada(admin, {
    organizationId: session.organization_id,
    contactId,
    conversationId,
    messageId: insertedMessage?.id ?? null,
    channelSessionId: session.id,
    texto,
    nomeDoContato: notifyNameOf(p),
    requestId,
    origem: "waha_webhook",
  });

  // ── POR QUE NÃO SE EMITE `message.received` AQUI ────────────────────────────
  //
  // Porque o BANCO já emite. O gatilho `trg_messages_emit_event` roda AFTER
  // INSERT em `messages`, sem filtrar canal, e chama `fn_emit_message_event`.
  // Esta função emitia a SEGUNDA cópia — só neste canal.
  //
  // Medido em produção antes de sair: 805 mensagens com DOIS eventos deste lado
  // e 30 com UM do outro. Os quatro consumidores registrados rodavam nas duas
  // linhas, então cada mensagem daqui era classificada duas vezes pelo modelo de
  // sentimento (duas chamadas pagas), a automação do usuário disparava duas
  // vezes, e a chave de idempotência do follow-up não protegia porque inclui o
  // id da LINHA de evento — que é diferente nas duas.
  //
  // O critério de aceite escrito em `docs/stories/epics/EPIC-03-inbox-messaging.md`
  // já dizia "2 events 'message.received'? NÃO — só 1". O duplicado gêmeo, o de
  // leads, foi aposentado na migration 0043; este passou despercebido porque a
  // guarda de `entity_kind` não separa os dois emissores (ambos usam "message").
  //
  // Quem precisar do preview do corpo: ele está na própria linha de `messages`,
  // alcançável pelo `message_id` que o gatilho manda.
  if (insertedMessage?.id) {
    const inboundMessageId = insertedMessage.id;
    if (mediaUrlOf(p)) {
      admin
        .rpc("emit_event" as never, {
          p_event_type: "media.persist_requested",
          p_entity_kind: "message",
          p_entity_id: inboundMessageId,
          p_payload: { message_id: inboundMessageId, conversation_id: conversationId },
          p_metadata: { source: "waha_webhook", request_id: requestId },
          p_organization_id: session.organization_id,
        } as never)
        .then(({ error }) => {
          if (error) console.error("[waha.ingest] emit media.persist_requested failed", error.message);
        });
    }
  }
}

/**
 * Esconde do cliente os comandos de controle (`#on`/`#off`).
 *
 * O operador digita o comando no MESMO chat do cliente — o celular dele é o
 * número do bot —, então sem revogar o cliente recebe literalmente "#off".
 * `DELETE .../messages/{id}` com `fromMe: true` é "apagar para todos" no WAHA.
 *
 * BEST-EFFORT de propósito: a mensagem JÁ está gravada e o efeito (pausar/ligar)
 * JÁ foi aplicado quando chegamos aqui. Falhar em revogar só deixa o comando
 * visível — não pode derrubar a ingestão nem desfazer a decisão.
 */
async function revogarComando(
  session: Session,
  chatId: string,
  messageId: string | undefined,
): Promise<void> {
  if (!messageId) return;
  const sessionName = session.waha_session_name;
  if (!sessionName) return;
  const client = getWahaClient();
  if (!client) return;
  try {
    await client.deleteMessage(sessionName, chatId, messageId);
  } catch (err) {
    logger.warn("[waha.ingest] não consegui revogar o comando do celular", {
      organization_id: session.organization_id,
      message_id: messageId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "erro",
    });
  }
}

/**
 * fromMe=true: operador respondeu direto do WhatsApp dele (não pelo composer).
 * Contato = destinatário (`to`). `from` é o próprio número do operador — nunca
 * vira contato. Registrado como outbound p/ o operador ver o histórico completo.
 */
async function handleOutboundFromUserPhone(
  admin: Admin,
  session: Session,
  p: WahaPayload,
  requestId: string,
): Promise<void> {
  // De onde sai o chat, em ordem de confiança:
  //   1. `to`  — o WEBJS manda; é o destinatário explícito.
  //   2. o id  — `{fromMe}_{chatId}_{bareId}` carrega o chat em qualquer engine.
  //   3. `from`— no NOWEB, mensagem fromMe traz o CHAT em `from` (não o número
  //              do operador, como acontece no WEBJS).
  //
  // O NOWEB (engine padrão do kit) **não manda `to`** aqui. Com `p.to ?? ""` o
  // chatId ficava vazio e a guarda abaixo descartava a mensagem em silêncio —
  // toda mensagem que o dono digitava no celular sumia do CRM, enquanto as
  // enviadas pelo composer e pela IA apareciam (essas nascem no banco antes do
  // webhook, então não dependiam deste caminho). O sintoma era "respondi pelo
  // celular e o CRM não mostra", sem nenhum erro em log: o webhook devolvia 200.
  const chatId = p.to ?? chatIdFromWaMessageId(p.id ?? "") ?? p.from ?? "";
  const parsed = parseChatId(chatId);
  if (parsed.kind === "group") return;
  if (!p.id) return;
  if (!p.body && !mediaUrlOf(p) && !p.hasMedia) return;
  // Idem inbound. Aqui o caso que mais dói é o chatId vazio: é literalmente o
  // defeito do #108 — mensagem que o dono digitou no celular sem `to`, sem id
  // composto e sem `from`. Se voltar a acontecer por um formato novo, agora sai
  // um evento em vez de silêncio.
  //
  // A metade `!chatId` da guarda anterior sai daqui junto: ela era condição
  // MORTA (varri 12 valores de `to` e nenhum a disparava, porque o único falsy
  // já era classificado como grupo uma linha acima) e voltaria a viver como
  // duplicata desta guarda, descartando calado justamente o caso que se quer ver.
  if (!ehEnderecavel(parsed)) {
    await avisarChatNaoReconhecido(admin, session.organization_id, session.id, chatId, "outbound");
    return;
  }

  // ── O NÚMERO INTERNO DE AVISOS NÃO VIRA ATENDIMENTO ─────────────────────
  //
  // ANTES do dedup por `external_id` e do `upsertContact`. O aviso sai por
  // TRANSPORTE DIRETO e não grava linha em `messages`, então o reconhecimento
  // de eco não o reconhece como nosso — sem este corte, o próprio aviso que
  // acabou de sair voltaria pelo webhook, viraria conversa com o número do
  // plantão e ainda chamaria `pausarIaPorAtendimentoManual` no fim.
  if (await ehNumeroInternoDeAviso(admin, session.organization_id, parsed)) {
    await registrarMensagemIgnorada(admin, session.organization_id, {
      direction: "outbound",
      sessionId: session.id,
    });
    return;
  }

  // ECO DO PRÓPRIO ENVIO — não duplicar.
  //
  // Toda mensagem que o CRM manda (composer ou IA) volta pelo webhook como
  // `fromMe=true`. O SELECT abaixo é CHECK-THEN-ACT — leitura e depois
  // escrita, sem transação —, então ele só enxerga o mundo de ANTES: se o
  // envio carimbar o `external_id` nesse intervalo, o SELECT não vê e o INSERT
  // roda solto. Fechar a janela é trabalho do `unique (organization_id,
  // external_id)` + da captura do `23505` que este mesmo handler já faz — a
  // mesma rede do inbound.
  //
  // Mas o unique só age se os DOIS lados gravarem a MESMA string. É o que
  // estava errado: o envio grava o id "bare" (`3EB0…`) e este eco chegava com
  // o composto (`true_<chat>_3EB0…`). Strings distintas, nenhuma colisão,
  // `23505` nunca disparava — e nascia a segunda linha com a mesma frase.
  //
  // Por isso o INSERT lá embaixo grava `bare`, não `p.id`: a forma canônica, a
  // mesma que o envio grava e a mesma que `handleAck` e `wahaEchoExternalIds`
  // (que traz o bare nos candidatos) já consultam. `tests/unit/
  // dedup-external-id-waha.test.ts` é a catraca: reprova com o id cru.
  //
  // Antes isto não aparecia por acidente: sem `to`, esta função voltava cedo e
  // o eco era descartado junto com as mensagens legítimas do celular. Ao
  // consertar aquele caminho, a duplicação ficou exposta.
  //
  // Mesmo par de candidatos que o `handleAck` usa — cobre NOWEB (bare) e WEBJS
  // (full) sem depender do engine.
  const bare = bareWaMessageId(p.id);
  const idCandidates = bare === p.id ? [p.id] : [p.id, bare];
  const { data: jaRegistrada } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", session.organization_id)
    .in("external_id", idCandidates)
    .limit(1)
    .maybeSingle();
  if (jaRegistrada) return; // nasceu no envio; quem atualiza o status é o ack

  // fromMe: o pushName do payload é o do OPERADOR, não do destinatário —
  // repassá-lo batizaria o contato do cliente com o nome da loja (e o
  // `coalesce` do fn_upsert_wa_contact congelaria o nome errado).
  //
  // O TELEFONE, ao contrário, vai: aqui `_data.key.remoteJid` é o chat do
  // DESTINATÁRIO, então `remoteJidAlt` é o número do cliente, não o da loja.
  // Medido na produção — inbound 56/56 e outbound 20/20 trazem o campo, e as
  // amostras de outbound mostram o número do cliente. Nome e telefone vêm de
  // lugares diferentes do mesmo payload, e só um deles inverte no envio.
  const contactId = await upsertContact(
    admin,
    session.organization_id,
    parsed,
    chatId,
    null,
    telefoneAlternativoDe(p),
  );
  if (!contactId) return;
  const conversationId = await upsertConversation(admin, session.organization_id, contactId, session.id);
  if (!conversationId) return;

  // Comando de controle vindo do celular (`#on`/`#off`). Só a mensagem INTEIRA
  // conta (ver `lib/escalacao/comando-de-canal.ts`). Reconhecer não é aplicar:
  // quem decide se vale é o interruptor do agente, lá embaixo.
  const comando = lerComandoDeControle(bodyOf(p));

  const now = new Date().toISOString();
  const { data: insertedOutbound, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      contact_id: contactId,
      external_id: bare,
      type: resolveMessageType(p),
      direction: "outbound",
      status: "sent",
      ack: p.ack ?? null,
      body: bodyOf(p),
      media_url: mediaUrlOf(p),
      media_mime: mediaMimeOf(p),
      sent_via: "external_device",
      sent_at: dataDoTimestamp(p.timestamp, now),
      metadata: { raw_type: p.type, fromMe: true },
    })
    .select("id")
    .maybeSingle();
  if (insertErr && insertErr.code !== "23505") {
    lancarFalhaDeIngestao("messages.insert outbound", insertErr);
  }
  if (insertErr?.code === "23505") {
    // Mesma razão do inbound: dedup é esperado, invisível não.
    logger.info("waha.ingest: outbound ja ingerido, dedup por external_id", {
      organization_id: session.organization_id,
      // A forma GRAVADA — é ela que a linha existente carimpa e que o grep por
      // `external_id` tem de achar; `p.id` é só o que o webhook entregou.
      external_id: bare,
      direcao: "outbound",
    });
    return;
  }

  await markConversation(admin, session.organization_id, conversationId, "outbound", previewFromMessage(p), now);

  // ── CONTROLE DO AUTOMÁTICO NESTA CONVERSA ─────────────────────────────────
  //
  // Três desfechos para uma mensagem `fromMe` que NÃO é eco:
  //   - `#off`         → pausa DURÁVEL (só `#on` ou a tela do CRM religam)
  //   - `#on`          → devolve o atendimento à IA (limpa as 3 travas)
  //   - mensagem normal → pausa (uma pessoa assumiu pelo celular)
  // Os dois comandos e a pausa DURÁVEL da mensagem normal só existem para o
  // agente que ligou "Comandos pelo celular". Desligado (o padrão), nada muda:
  // `#on`/`#off` são texto comum e a pausa tem prazo (`PRAZO_DO_SILENCIO_MS`).
  //
  // ⚠️ A GUARDA DE ECO VEM PRIMEIRO, e a ordem importa. O eco de um envio nosso
  // (composer/IA) chega por este mesmo caminho com `fromMe`, e não pode ser lido
  // como comando nem como "humano assumiu". O `jaRegistrada` acima NÃO basta: o
  // envio grava a linha ANTES de falar com o canal (`status='queued'`,
  // `external_id` NULL), e nessa janela o dedup não casa — o eco chega e esta
  // função concluía "humano assumiu". A tela mostrava "Automático pausado", um
  // estado legítimo que ninguém investiga. (issue #519, consertada no #521)
  //
  // As DUAS decisões que eram uma só se separam aqui, e em direções OPOSTAS de
  // propósito:
  //   gravar a linha   -> tolerante (na dúvida grava; perder mensagem é pior que
  //                                  duplicar — é o #108, que já custou caro)
  //   mexer no automa. -> ESTRITO   (na dúvida NÃO age; calar/ligar a IA por
  //                                  engano é pior que não agir)
  // Quem reaproveitar esta condição para pular o INSERT reabre o #108.
  const ehEco = await ehEcoDeEnvioNosso(admin, session.organization_id, conversationId, p);
  let comandoAplicado: typeof comando = null;
  if (!ehEco) {
    let revogar = true;
    // C-076: o interruptor é do agente que atende ESTA conversa
    // (`ai_agents.config.aceita_comandos_celular`, ligado na tela). FAIL-CLOSED:
    // falha de leitura ⇒ desligado ⇒ o comportamento de antes do recurso.
    const aceita = await agenteAceitaComandoDeCelular(admin, session.organization_id, conversationId);
    comandoAplicado = aceita ? comando : null;
    if (comandoAplicado === "off") {
      await pausarIaDuravelmente(admin, {
        organizationId: session.organization_id,
        conversationId,
        canal: "waha",
        motivo: MOTIVO_COMANDO_OFF,
      });
    } else if (comandoAplicado === "on") {
      const devolucao = await devolverAtendimentoAoAgente(
        {
          supabase: admin,
          organizationId: session.organization_id,
          actor: { type: "webhook_source", id: session.id },
          requestId,
        },
        { conversationId },
      );
      if (!devolucao.ok) {
        // O `#on` fica VISÍVEL no chat: é o único sinal de que o atendente
        // precisa repetir (ou devolver pela tela).
        revogar = false;
        logger.warn("waha.ingest: #on do celular nao devolveu o atendimento ao agente", {
          organization_id: session.organization_id,
          conversation_id: conversationId,
          erro: devolucao.erro,
          detalhe: devolucao.detalhe,
        });
      }
    } else {
      await pausarIaPorAtendimentoManual(admin, {
        organizationId: session.organization_id,
        conversationId,
        canal: "waha",
        duravel: aceita,
      });
    }
    // O comando não é fala de atendimento: esconde do cliente depois de aplicar.
    if (comandoAplicado && revogar) await revogarComando(session, chatId, p.id);
  }

  await audit({
    action: "message.sent",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: {
      conversation_id: conversationId,
      type: p.type,
      external_id: p.id,
      from_user_phone: true,
      ...(comandoAplicado ? { control_command: comandoAplicado } : {}),
    },
  });

  if (insertedOutbound?.id && mediaUrlOf(p)) {
    admin
      .rpc("emit_event" as never, {
        p_event_type: "media.persist_requested",
        p_entity_kind: "message",
        p_entity_id: insertedOutbound.id,
        p_payload: { message_id: insertedOutbound.id, conversation_id: conversationId },
        p_metadata: { source: "waha_webhook", request_id: requestId },
        p_organization_id: session.organization_id,
      } as never)
      .then(({ error }) => {
        if (error) console.error("[waha.ingest] emit media.persist_requested failed", error.message);
      });
  }
}

async function handleAck(admin: Admin, session: Session, p: WahaPayload): Promise<void> {
  if (!p.id) return;
  const ack = p.ack ?? 0;
  const status = ackToStatus(ack);
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { ack, status };
  if (ack >= 2) update.delivered_at = now;
  if (ack >= 3) update.read_at = now;

  // O ack do WAHA 2026.x vem como `{fromMe}_{chatId}_{bareId}`. O NOWEB grava
  // `external_id` = bareId (id interno), o WEBJS grava o `_serialized` completo.
  // Casar as duas formas cobre ambos os engines sem tocar no external_id de
  // inbound (que é full e sustenta o dedup 23505).
  const bare = bareWaMessageId(p.id);
  const candidates = bare === p.id ? [p.id] : [p.id, bare];
  await admin
    .from("messages")
    .update(update)
    .eq("organization_id", session.organization_id)
    .in("external_id", candidates);
}

interface SessionStatusRow extends Session {
  is_warmup_complete: boolean | null;
  warmup_started_at: string | null;
}

async function handleSessionStatus(
  admin: Admin,
  session: SessionStatusRow,
  p: WahaPayload,
): Promise<void> {
  const status = (p.status ?? "").toUpperCase() || null;
  if (!status) return;
  const allowed = new Set(["STARTING", "SCAN_QR_CODE", "WORKING", "STOPPED", "FAILED"]);
  if (!allowed.has(status)) return;
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { status, last_status_change_at: now };
  if (status === "WORKING" && session.warmup_started_at && !session.is_warmup_complete) {
    // Só `warmup_completed_at`: `is_warmup_complete` é `GENERATED ALWAYS AS
    // (warmup_completed_at IS NOT NULL)`, e atribuir a ela abortava o UPDATE
    // INTEIRO — inclusive o `status`, que nada tem a ver com warm-up. Ou seja: a
    // sessão que terminava o aquecimento parava de atualizar o próprio estado, e
    // o espelho do canal congelava sem erro visível.
    update.warmup_completed_at = now;
  }
  await admin.from("channel_sessions").update(update).eq("id", session.id);

  // ─── E agora alguém precisa SABER ────────────────────────────────────────
  //
  // Até aqui esta função gravava o estado numa coluna e não contava a ninguém.
  // Foi assim que uma desconexão real passou horas despercebida: o evento
  // chegou, a coluna atualizou, e o dono só descobriu ao estranhar que ninguém
  // escrevia. O estado certo no lugar que ninguém olha não vale nada.
  //
  // O apelido é buscado aqui, e não recebido: com dois números ligados, um aviso
  // que não diz QUAL conexão caiu obriga o operador a adivinhar. É uma consulta
  // a mais num evento raro — status muda algumas vezes por dia, não por minuto.
  const { data: apelidoRow } = await admin
    .from("channel_sessions")
    .select("display_name, phone_number")
    .eq("id", session.id)
    .maybeSingle();

  await sincronizarSaudeDaConexao(
    admin,
    { id: session.id, organization_id: session.organization_id, status },
    // Veio do próprio transporte: se ele conseguiu nos contar, está alcançável.
    { reachable: true, status, detail: null },
    (apelidoRow?.display_name as string | null) ??
      (apelidoRow?.phone_number as string | null) ??
      "sem nome",
  );
}

/**
 * O autor editou a mensagem no aplicativo.
 *
 * O corpo é SOBRESCRITO, e não versionado: o que o CRM mostra tem que ser o que
 * o cliente vê agora. Guardar as versões anteriores é outra feature (histórico
 * de edição), com tela e retenção próprias — fazê-la pela metade acumularia
 * dado pessoal num campo que ninguém mostra e que a anonimização não conhece.
 *
 * `editedMessageId` é o id da mensagem ORIGINAL; o `id` do payload é o do
 * evento de edição. Casar pelo `id` não acharia nada — e o silêncio pareceria
 * "funcionou", que é exatamente o modo de falha que este arquivo já pagou caro
 * em outros lugares.
 */
async function handleMessageEdited(
  admin: Admin,
  session: Session,
  p: WahaPayload,
): Promise<void> {
  const alvo = bareWaMessageId(p.editedMessageId ?? "");
  const corpo = typeof p.body === "string" ? p.body : null;
  if (!alvo || corpo === null) return;

  await admin
    .from("messages")
    .update({ body: corpo, edited_at: new Date().toISOString() })
    .eq("organization_id", session.organization_id)
    .eq("external_id", alvo);
}

/**
 * O autor apagou a mensagem ("apagar para todos").
 *
 * A linha NÃO é removida: sumir com ela apagaria o contexto das vizinhas — uma
 * resposta passaria a responder ao nada — e o histórico de quem atendeu. O
 * corpo também não é limpo aqui: quem decide o que mostrar é a tela, e apagar o
 * texto no banco impediria o próprio atendente de entender, depois, o que tinha
 * sido combinado antes do arrependimento.
 */
async function handleMessageRevoked(
  admin: Admin,
  session: Session,
  p: WahaPayload,
): Promise<void> {
  const alvo = bareWaMessageId(p.revokedMessageId ?? "");
  if (!alvo) return;

  await admin
    .from("messages")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", session.organization_id)
    .eq("external_id", alvo);
}

/**
 * Roteador único de eventos WAHA. Os dois route handlers convergem aqui após
 * resolver a sessão e validar HMAC.
 */
export async function dispatchWahaEvent(
  admin: Admin,
  session: SessionStatusRow,
  envelope: WahaEnvelope,
  requestId: string,
): Promise<void> {
  const eventType = envelope.event ?? "unknown";
  const payload: WahaPayload = envelope.payload ?? {};

  if (eventType === "message" || eventType === "message.any") {
    if (payload.fromMe) {
      await handleOutboundFromUserPhone(admin, session, payload, requestId);
    } else {
      await handleInbound(admin, session, payload, requestId);
    }
  } else if (eventType === "message.ack") {
    await handleAck(admin, session, payload);
  } else if (eventType === "message.edited") {
    await handleMessageEdited(admin, session, payload);
  } else if (eventType === "message.revoked") {
    await handleMessageRevoked(admin, session, payload);
  } else if (eventType === "session.status" || eventType === "state.change") {
    await handleSessionStatus(admin, session, payload);
  }
}
