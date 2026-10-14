import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * Importação do histórico do WhatsApp (migration 0561): histórico é DADO, nunca
 * evento. A importação é arquiteturalmente incapaz de iniciar resposta de IA,
 * follow-up, reengajamento, automação, campanha, notificação, webhook de saída
 * ou envio.
 *
 * Por que o corte é provado no BANCO: todo INSERT inbound em `messages` emite
 * `message.received` por gatilho (oito consumidores, um deles webhook EXTERNO) e
 * abre atendimento/demanda. Um teste que olhasse só os workers deixaria esse
 * caminho sem prova.
 *
 * O teste central importa 10.000 mensagens (100 chats × 100) e exige ZERO linha
 * nova em `event_log` da organização — de QUALQUER tipo —, zero demanda, zero
 * job, zero matrícula de follow-up, zero mensagem em status de envio.
 *
 * Namespace próprio (da7a…) para rodar em paralelo com os outros invariantes.
 */

const id = (grupo: string, n: number) =>
  `da7a0000-${grupo}-4000-8000-${String(n).padStart(12, "0")}`;

const ORG = id("0001", 1);
const OUTRA_ORG = id("0001", 2);
const SESSAO = id("0002", 1);
const SESSAO_SEM_CONEXAO = id("0002", 2);
const ADMIN = id("0003", 1);
const AGENTE = id("0003", 2);
const ADMIN_OUTRA = id("0003", 3);
const IMPORT = id("0004", 1);
const IMPORT_SEM_CONEXAO = id("0004", 2);
/** Primeira conexão do número: todo histórico é anterior a isto. */
const CORTE = "2026-09-21 19:41:34+00";

const num = (r: string) => {
  const linha = lastLine(sql(r));
  if (!/^-?\d+$/.test(linha)) throw new Error(`saída inesperada do psql: ${linha}`);
  return Number(linha);
};
const txt = (r: string) => lastLine(sql(r));

/** Contato em JSON para a função, a partir de um índice. */
const contato = (i: number) =>
  `jsonb_build_object('kind','phone','phone','+55119' || lpad('${i}', 8, '0'),
     'chat_id','55119' || lpad('${i}', 8, '0') || '@c.us','notify_name','Hist ${i}')`;

/** `n` mensagens do chat `i`, terminando `diasAntes` dias antes do corte; 1 em 3 é do celular (fromMe). */
const lote = (i: number, n: number, diasAntes = 1) => `(
  select jsonb_agg(jsonb_build_object(
    'external_id', (case when k % 3 = 0 then 'true' else 'false' end)
                   || '_55119' || lpad('${i}', 8, '0') || '@c.us_H${i}X' || k,
    'from_me', k % 3 = 0,
    'type', 'text',
    'body', 'mensagem histórica ' || k,
    'raw_type', 'chat',
    'sent_at', (timestamptz '${CORTE}' - interval '${diasAntes} days' - make_interval(mins => k))::text))
  from generate_series(1, ${n}) k)`;

const importar = (imp: string, i: number, mensagens: string) =>
  `select public.fn_importar_conversa_historica('${imp}', ${contato(i)}, ${mensagens});`;

const eventosDaOrg = () => num(`select count(*) from public.event_log where organization_id = '${ORG}';`);

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'h1s7-admin@invariant.test'),
      ('${AGENTE}', 'h1s7-agente@invariant.test'),
      ('${ADMIN_OUTRA}', 'h1s7-admin-outra@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'h1s7', 'Hist Org', 'Hist'),
      ('${OUTRA_ORG}', 'h1s7-outra', 'Hist Outra', 'Hist Outra')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN}', '${ORG}', 'admin', now()),
      ('${AGENTE}', '${ORG}', 'agent', now()),
      ('${ADMIN_OUTRA}', '${OUTRA_ORG}', 'admin', now())
      on conflict do nothing;
    do $h$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status, first_connected_at)
        values ('${SESSAO}', '${ORG}', 'h1s7', '\\x00'::bytea, 'WORKING', '${CORTE}');
    exception when unique_violation then null; end $h$;
    do $h$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status)
        values ('${SESSAO_SEM_CONEXAO}', '${ORG}', 'h1s7-nova', '\\x00'::bytea, 'SCAN_QR_CODE');
    exception when unique_violation then null; end $h$;
    insert into public.whatsapp_history_imports
      (id, organization_id, channel_session_id, requested_by_user_id, janela_inicio, janela_fim, status) values
      ('${IMPORT}', '${ORG}', '${SESSAO}', '${ADMIN}', timestamptz '${CORTE}' - interval '90 days', now(), 'em_andamento'),
      ('${IMPORT_SEM_CONEXAO}', '${ORG}', '${SESSAO_SEM_CONEXAO}', '${ADMIN}', timestamptz '${CORTE}' - interval '90 days', now(), 'em_andamento')
      on conflict do nothing;
  `);
});

describe("inventário: quem reage a uma linha nova", () => {
  // Se alguém acrescentar um gatilho nestas tabelas, este teste reprova e obriga
  // a decidir, por escrito, se ele precisa ignorar o histórico.
  it("os gatilhos de messages/conversations/contacts são os auditados na 0561", () => {
    const lista = txt(`
      select string_agg(c.relname || '.' || t.tgname, ',' order by c.relname, t.tgname)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
         and c.relname in ('messages', 'conversations', 'contacts');`);
    expect(lista.split(",")).toEqual(
      [
        // messages — os de INSERT ignoram `origem = 'historico'` (0561); os de
        // UPDATE não disparam: a importação só INSERE mensagem.
        "messages.trg_demanda_abre_no_inbound",
        "messages.trg_message_service_lock",
        "messages.trg_messages_emit_event",
        "messages.trg_reply_inbound_revision",
        "messages.trg_appointment_inbound",
        "messages.trg_messages_sincroniza_campanha",
        "messages.trg_messages_updated_at",
        // conversations — no INSERT: o rodízio ignora conversa FECHADA (é como a
        // importação cria), e o do Meet só reescreve link. Os de UPDATE não
        // disparam: conversa existente não é tocada.
        "conversations.trg_conversation_routing_requested",
        "conversations.trg_meet_minimize_runtime",
        "conversations.trg_conversations_updated_at",
        "conversations.trg_reply_conversation_revision",
        "conversations.trg_routing_assignment_changed",
        "conversations.trg_service_reopened_routing",
        "conversations.trg_service_stamp_status",
        // contacts — todos de UPDATE, acionados por `fn_upsert_wa_contact` IGUAL
        // ao webhook ao vivo; os de anonimização/opt-out/humano só agem quando
        // `is_anonymized`/`is_blocked`/`force_human` MUDAM, e a importação não
        // muda nenhum deles.
        "contacts.trg_contact_redaction_lock",
        "contacts.trg_contacts_anonimizado_limpa_custom_fields",
        "contacts.trg_contacts_anonimizado_limpa_propostas",
        "contacts.trg_contacts_updated_at",
        "contacts.trg_contato_anonimizado_encerra_roteiro",
        "contacts.trg_contato_colunas_de_cliente",
        "contacts.trg_contato_encerra_roteiro_com_humano_ou_opt_out",
        "contacts.trg_google_redact_contact",
        "contacts.trg_meet_redact_contact",
        "contacts.trg_redigir_agenda_ao_anonimizar",
        "contacts.trg_redigir_campanhas_anonimizado",
        "contacts.trg_redigir_captacoes_ao_anonimizar",
        "contacts.trg_redigir_conversas_ao_anonimizar",
        "contacts.trg_redigir_exclusoes_anonimizado",
        "contacts.trg_redigir_tarefas_ao_anonimizar",
        "contacts.trg_reply_redact",
      ].sort(),
    );
  });
});

describe("10.000 mensagens históricas, zero efeito", () => {
  let antes: number;
  let depois: number;
  let jobsAntes: number;
  let followAntes: number;

  beforeAll(() => {
    antes = eventosDaOrg();
    jobsAntes = num(`select count(*) from public.job_queue;`);
    followAntes = num(`select count(*) from public.followup_enrollments where organization_id = '${ORG}';`);
    const chamadas = Array.from({ length: 100 }, (_, i) => importar(IMPORT, i + 1, lote(i + 1, 100))).join("\n");
    sql(chamadas);
    depois = eventosDaOrg();
  });

  it("as 10.000 entram, todas como histórico", () => {
    expect(
      num(`select count(*) from public.messages where organization_id = '${ORG}' and origem = 'historico';`),
    ).toBe(10_000);
    expect(
      txt(`select mensagens_importadas || ',' || contatos_criados || ',' || conversas_criadas
             from public.whatsapp_history_imports where id = '${IMPORT}';`),
    ).toBe("10000,100,100");
  });

  it("ZERO linha nova no event_log da organização — de qualquer tipo", () => {
    expect(depois - antes).toBe(0);
  });

  it("ZERO demanda, ZERO job, ZERO matrícula de follow-up", () => {
    expect(num(`select count(*) from public.demandas where organization_id = '${ORG}';`)).toBe(0);
    expect(num(`select count(*) from public.job_queue;`)).toBe(jobsAntes);
    expect(
      num(`select count(*) from public.followup_enrollments where organization_id = '${ORG}';`),
    ).toBe(followAntes);
  });

  it("ZERO mensagem em status de envio; o que veio do celular é 'sent'", () => {
    expect(
      num(`select count(*) from public.messages where organization_id = '${ORG}'
             and origem = 'historico' and status in ('queued', 'sending', 'failed');`),
    ).toBe(0);
    expect(
      txt(`select string_agg(distinct direction || ':' || status, ',' order by direction || ':' || status)
             from public.messages where organization_id = '${ORG}' and origem = 'historico';`),
    ).toBe("inbound:received,outbound:sent");
  });

  it("toda conversa criada nasce FECHADA, sem dono, sem não lida e sem pedido de rodízio", () => {
    expect(
      txt(`select string_agg(distinct status || ':' || coalesce(assigned_to_user_id::text, '-') || ':' || unread_count_for_assignee, ',')
             from public.conversations where organization_id = '${ORG}' and metadata->>'origem' = 'historico';`),
    ).toBe("closed:-:0");
  });

  it("a IA recusa responder mensagem histórica — antes de qualquer outra regra", () => {
    expect(
      txt(`select public.fn_ia_pode_responder_mensagem('${ORG}',
             (select id from public.messages where organization_id = '${ORG}' and origem = 'historico'
               and direction = 'inbound' limit 1));`),
    ).toBe("mensagem_historica");
  });

  it("reimportar o mesmo lote não duplica nada", () => {
    const r = txt(importar(IMPORT, 1, lote(1, 100)));
    expect(JSON.parse(r)).toMatchObject({ importadas: 0, duplicadas: 100 });
  });
});

describe("a janela e o corte", () => {
  it("mensagem a partir da primeira conexão é recusada (fora da janela)", () => {
    const depoisDoCorte = `(select jsonb_agg(jsonb_build_object('external_id','false_55119' || lpad('900', 8, '0')
        || '@c.us_POS' || k, 'from_me', false, 'type','text','body','nova','sent_at',
        (timestamptz '${CORTE}' + make_interval(mins => k))::text)) from generate_series(0, 4) k)`;
    const r = JSON.parse(txt(importar(IMPORT, 900, depoisDoCorte)));
    expect(r).toMatchObject({ importadas: 0, fora_da_janela: 5, contato_criado: false });
  });

  it("sessão sem primeira conexão não importa nada (fail-closed)", () => {
    expect(() => sql(importar(IMPORT_SEM_CONEXAO, 901, lote(901, 3)))).toThrow(/sessao_sem_primeira_conexao/);
  });

  it("importação que não está em andamento não importa nada", () => {
    sql(`update public.whatsapp_history_imports set status = 'cancelada' where id = '${IMPORT_SEM_CONEXAO}';`);
    expect(() => sql(importar(IMPORT_SEM_CONEXAO, 902, lote(902, 3)))).toThrow(/importacao_nao_esta_em_andamento/);
  });

  it("mensagem vazia, de tipo não suportado ou sem data é descartada", () => {
    const ruins = `jsonb_build_array(
      jsonb_build_object('external_id','false_x@c.us_V1','type','text','body','  ','sent_at','2026-09-01T00:00:00Z'),
      jsonb_build_object('external_id','false_x@c.us_V2','type','reaction','body','👍','sent_at','2026-09-01T00:00:00Z'),
      jsonb_build_object('external_id','false_x@c.us_V3','type','text','body','sem data'))`;
    expect(JSON.parse(txt(importar(IMPORT, 903, ruins)))).toMatchObject({ importadas: 0, descartadas: 3 });
  });
});

describe("conversa já existente e mensagem ao vivo concorrente", () => {
  it("importar numa conversa aberta não mexe em status, dono, prévia nem não lidas", () => {
    // Conversa AO VIVO aberta, criada antes, como o webhook faria.
    sql(`
      select public.fn_upsert_wa_contact('${ORG}', 'phone', '+5511988887777', null, '5511988887777@c.us', 'Vivo');
      update public.conversations set status = 'open'
       where id = public.fn_upsert_wa_conversation('${ORG}',
         (select id from public.contacts where organization_id = '${ORG}' and phone_number = '+5511988887777'), '${SESSAO}');
    `);
    const antes = txt(`select status || '|' || coalesce(last_message_preview, '-') || '|' || unread_count_for_assignee || '|' || coalesce(assigned_to_user_id::text, '-')
      from public.conversations c join public.contacts ct on ct.id = c.contact_id
      where c.organization_id = '${ORG}' and ct.phone_number = '+5511988887777';`);
    const r = txt(`select public.fn_importar_conversa_historica('${IMPORT}',
      jsonb_build_object('kind','phone','phone','+5511988887777','chat_id','5511988887777@c.us'),
      (select jsonb_agg(jsonb_build_object('external_id','false_5511988887777@c.us_OLD' || k,'from_me',false,
        'type','text','body','antiga ' || k,'sent_at',(timestamptz '${CORTE}' - make_interval(days => k))::text))
       from generate_series(1, 5) k));`);
    expect(JSON.parse(r)).toMatchObject({ importadas: 5, conversa_criada: false });
    const depois = txt(`select status || '|' || coalesce(last_message_preview, '-') || '|' || unread_count_for_assignee || '|' || coalesce(assigned_to_user_id::text, '-')
      from public.conversations c join public.contacts ct on ct.id = c.contact_id
      where c.organization_id = '${ORG}' and ct.phone_number = '+5511988887777';`);
    expect(depois).toBe(antes);
  });

  it("uma mensagem nova AO VIVO no meio da importação é registrada normalmente — e só ela emite evento", () => {
    const ev0 = eventosDaOrg();
    sql(`
      ${importar(IMPORT, 950, lote(950, 50))}
      insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id,
        external_id, type, direction, status, body, sent_via, sent_at)
      select '${ORG}', c.id, '${SESSAO}', c.contact_id, 'false_5511988887777@c.us_AOVIVO1', 'text',
             'inbound', 'delivered', 'oi, mensagem nova', 'external_device', now()
        from public.conversations c join public.contacts ct on ct.id = c.contact_id
       where c.organization_id = '${ORG}' and ct.phone_number = '+5511988887777';
      ${importar(IMPORT, 951, lote(951, 50))}
    `);
    // 100 históricas + 1 ao vivo: só a ao vivo gerou `message.received`.
    expect(
      num(`select count(*) from public.event_log where organization_id = '${ORG}'
             and event_type = 'message.received'
             and (payload->>'message_id')::uuid in (select id from public.messages where origem = 'historico');`),
    ).toBe(0);
    expect(
      num(`select count(*) from public.event_log e where e.organization_id = '${ORG}'
             and e.event_type = 'message.received'
             and (e.payload->>'message_id')::uuid = (select id from public.messages where external_id = 'false_5511988887777@c.us_AOVIVO1');`),
    ).toBe(1);
    expect(eventosDaOrg() - ev0).toBeGreaterThanOrEqual(1);
    expect(num(`select count(*) from public.messages where organization_id = '${ORG}' and external_id like '%H95_X%';`)).toBe(100);
  });
});

describe("LGPD: quem foi anonimizado não volta pela importação", () => {
  it("contato resolvido que já está anonimizado tem o chat inteiro descartado", () => {
    // Defesa extra: a anonimização zera `source_metadata` (e com ele o lid), então
    // aqui o lid é posto à mão para a importação RESOLVER um contato anonimizado.
    sql(`
      insert into public.contacts (organization_id, display_name, source_metadata, is_anonymized, anonymized_at)
        values ('${ORG}', 'Cliente Anonimizado #1', '{"waha_lid":"777000111"}', true, now());
    `);
    const r = txt(`select public.fn_importar_conversa_historica('${IMPORT}',
      jsonb_build_object('kind','lid','lid','777000111','chat_id','777000111@lid'),
      jsonb_build_array(jsonb_build_object('external_id','false_777000111@lid_ANON1','type','text',
        'body','dado de quem pediu exclusão','sent_at','2026-09-01T00:00:00Z')));`);
    expect(JSON.parse(r)).toMatchObject({ importadas: 0, descartadas: 1 });
  });

  it("contato anonimizado só por telefone (telefone apagado) é reconhecido pelo id das mensagens ao vivo", () => {
    sql(`
      do $h$ declare ct uuid; cv uuid; begin
        ct := public.fn_upsert_wa_contact('${ORG}', 'phone', '+5511977776666', null, '5511977776666@c.us', 'Titular');
        cv := public.fn_upsert_wa_conversation('${ORG}', ct, '${SESSAO}');
        insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id,
          external_id, type, direction, status, body, sent_via, sent_at)
        values ('${ORG}', cv, '${SESSAO}', ct, 'false_5511977776666@c.us_VIVO9', 'text', 'inbound',
          'delivered', 'oi', 'external_device', now());
        update public.contacts set phone_number = null, is_anonymized = true, anonymized_at = now(),
          display_name = 'Cliente Anonimizado #2' where id = ct;
      end $h$;
    `);
    const contatosAntes = num(`select count(*) from public.contacts where organization_id = '${ORG}';`);
    const r = txt(`select public.fn_importar_conversa_historica('${IMPORT}',
      jsonb_build_object('kind','phone','phone','+5511977776666','chat_id','5511977776666@c.us'),
      jsonb_build_array(jsonb_build_object('external_id','false_5511977776666@c.us_ANTIGA','type','text',
        'body','histórico de quem pediu exclusão','sent_at','2026-09-01T00:00:00Z')));`);
    expect(JSON.parse(r)).toMatchObject({ importadas: 0, descartadas: 1, contato_criado: false });
    expect(num(`select count(*) from public.contacts where organization_id = '${ORG}';`)).toBe(contatosAntes);
  });
});

describe("acesso", () => {
  const como = (u: string, q: string) =>
    num(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false); ${q}`);

  it("o recibo: admin da org lê; agente não; admin de outra org não", () => {
    const q = `select count(*) from public.whatsapp_history_imports where organization_id = '${ORG}';`;
    expect(como(ADMIN, q)).toBeGreaterThan(0);
    expect(como(AGENTE, q)).toBe(0);
    expect(como(ADMIN_OUTRA, q)).toBe(0);
  });

  it("ninguém logado escreve no recibo nem executa a importação; anon não lê", () => {
    expect(() =>
      sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', false);
           update public.whatsapp_history_imports set status = 'concluida' where id = '${IMPORT}';`),
    ).toThrow(/permission denied/);
    expect(() =>
      sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', false);
           ${importar(IMPORT, 990, lote(990, 1))}`),
    ).toThrow(/permission denied/);
    expect(() => sql(`set role anon; select count(*) from public.whatsapp_history_imports;`)).toThrow(
      /permission denied/,
    );
  });
});
