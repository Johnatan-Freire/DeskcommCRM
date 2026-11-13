-- manifest: **Anonimizar um contato (LGPD) alcança as fichas que foram fundidas nele.** `fn_mesclar_contatos` move conversas e negócios para o contato principal, mas a ficha absorvida continua existindo, com o nome, o telefone e o que mais tinha antes da fusão, apontando para o principal por `is_merged_into`. A cascata anonimizava só o titular, e essas fichas ficavam intactas. Agora `fn_lgpd_cascade_redact_contact` chama a si mesma para cada ficha fundida no contato (mesma organização, fusão com data, ainda não anonimizada), o que também cobre fusão de fusão e encerra ciclos. Cada ficha leva a própria linha de auditoria, e o retorno ganha `fichas_fundidas`. Um contato já anonimizado ainda leva as fichas que ficaram para trás, e um bloco de dados faz isso nos bancos existentes (repetir não acha ninguém). O gatilho `trg_contacts_fusao_e_anonimizacao_so_pelo_servidor` (da 9243 do upstream) impede a sessão de mudar fusão e anonimização direto pela REST: só as funções do servidor (`security definer`) gravam esses campos. Corresponde à 9243 do upstream (#4384), refeita sobre a cascata do fork, que não tem `contact_phones`, fila de avatar nem anexos de negócio. Faixa 8xxx: número próprio do fork. Espelho no apêndice do `supabase/baseline.sql`; prova em `tests/invariants/lgpd-alcanca-fichas-fundidas.test.ts`.
--
-- 8005 — a anonimização alcança as fichas fundidas no contato.

create or replace function public.fn_lgpd_cascade_redact_contact(p_organization_id uuid, p_contact_id uuid, p_request_id uuid) returns jsonb
    language plpgsql security definer
    set search_path to 'public', 'extensions', 'pg_temp'
    as $$
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_anon_label text;
  v_count int;
  v_variantes text[] := '{}';
  v_fundida uuid;
  v_sub jsonb;
  v_fundidas jsonb := '[]'::jsonb;
begin
  perform public.fn_service_lock(p_organization_id,p_contact_id);
  select is_anonymized into v_already
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_already then
    -- 8005: um contato já anonimizado ainda leva as fichas fundidas nele que
    -- ficaram para trás (anonimizado antes desta versão). Repetir não acha ninguém.
    for v_fundida in
      select c.id from contacts c
       where c.organization_id = p_organization_id and c.is_merged_into = p_contact_id
         and c.merged_at is not null and not c.is_anonymized and c.id <> p_contact_id
       order by c.id
    loop
      v_sub := public.fn_lgpd_cascade_redact_contact(p_organization_id, v_fundida, p_request_id);
      v_fundidas := v_fundidas || jsonb_build_array(jsonb_build_object('contact_id', v_fundida, 'counts', v_sub->'counts'));
      v_media_paths := v_media_paths || coalesce(array(select jsonb_array_elements_text(v_sub->'media_paths')), '{}');
    end loop;
    return jsonb_build_object('already_anonymized', true, 'counts', v_counts, 'media_paths', v_media_paths,
                              'fichas_fundidas', v_fundidas);
  end if;

  -- O rótulo NÃO deriva mais do id (issue #2342 do upstream): sufixo OPACO gerado por
  -- `fn_lgpd_rotulo_anonimizado`. Antes, os 8 primeiros caracteres do uuid do contato
  -- permitiam reidentificar o titular pelo próprio rótulo.
  v_anon_label := public.fn_lgpd_rotulo_anonimizado(p_contact_id);

  select coalesce(public.fn_telefone_variantes(phone_number), '{}')
    into v_variantes
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  select coalesce(array_agg(distinct media_storage_path) filter (where media_storage_path is not null), '{}')
    into v_media_paths
    from messages
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      );

  -- 1. contacts (irreversible)
  update contacts set
    name = v_anon_label,
    display_name = v_anon_label,
    email = null,
    phone_number = null,
    cpf_encrypted = null,
    cpf_hash = null,
    birthdate = null,
    is_anonymized = true,
    anonymized_at = now(),
    consent = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  -- 2. conversations metadata + preview strip
  update conversations set
    metadata = '{}'::jsonb,
    last_message_preview = null,
    last_handoff_reason = null,
    updated_at = now()
  where contact_id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  -- 3. messages: redact body + null media + strip metadata (preserve status/timestamps/conversation_id)
  update messages set
    body = '[mensagem anonimizada]',
    media_url = null,
    media_mime = null,
    media_size_bytes = null,
    media_storage_path = null,
    media_derived_text = null,
    metadata = '{}'::jsonb,
    -- `external_id` guarda o TELEFONE do titular no inbound: zerado, era a última PII viva.
    external_id = null,
    updated_at = now()
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_count);

  -- 4. crm_lead_activities — strip payload, metadata E reason (migration 0071).
  update crm_lead_activities set
    payload = '{}'::jsonb,
    metadata = '{}'::jsonb,
    reason = null
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('activities', v_count);

  -- 5. crm_leads — strip title/description/custom_fields/source_metadata/tags but PRESERVE pipeline/stage/value
  update crm_leads set
    title = v_anon_label,
    description = null,
    custom_fields = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_count);

  -- 6. orders — PRESERVE values + status + timestamps. Strip personal fields from payload jsonb
  --    and replace customer_external_id with null (FK-safe; soft de-link). Keep contact_id null.
  update orders set
    payload = (coalesce(payload, '{}'::jsonb))
      - 'customer'
      - 'customer_name'
      - 'customer_email'
      - 'customer_phone'
      - 'shipping_address'
      - 'billing_address'
      - 'contact_identification',
    customer_external_id = null,
    contact_id = null,
    is_anonymized = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_count);

  -- Capital Code: o módulo de propostas (0464/0477) não foi portado. A seção
  -- só roda se a tabela existir — PL/pgSQL só prepara o comando ao executá-lo,
  -- então o ramo não executado não falha por relação inexistente.
  if to_regclass('public.crm_proposals') is not null then
    -- 6b. crm_proposals (migration 0477, #1504) — PRESERVA número, valores,
    -- itens, datas e status; redige só o que identifica a PESSOA. Ver o
    -- cabeçalho desta migration para o porquê de cada coluna.
    -- O PDF que o cliente recebeu (bucket `propostas`, `<org>/<proposta>.pdf`)
    -- tem o nome dele impresso: redigir as colunas e deixar o arquivo seria
    -- anonimizar a linha e manter o documento. Vai para a mesma fila de expurgo
    -- da mídia (passo 7), com o bucket CERTO — a mensagem que levou o PDF
    -- aponta para o mesmo caminho, mas o passo 7 só enfileira `whatsapp-media`.
    -- Lido ANTES de o passo seguinte zerar `pdf_path`.
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'propostas', pdf_path
      from crm_proposals
     where organization_id = p_organization_id
       and contact_id = p_contact_id
       and pdf_path is not null and length(pdf_path) > 0
       -- só arquivo DESTA organização: o expurgo nunca alcança o PDF de outra
       and pdf_path like p_organization_id::text || '/%'
    on conflict (bucket, object_path) do nothing;
    update crm_proposals set
      destinatario_nome = v_anon_label,
      briefing_json = '{}'::jsonb,
      resumo_comercial = null,
      -- o texto do documento como foi montado e como foi editado à mão: é o
      -- conteúdo do PDF, com o mesmo nome dentro.
      rendered_snapshot = null,
      secoes_editadas = null,
      pdf_path = null,
      updated_at = now()
    where organization_id = p_organization_id
      and contact_id = p_contact_id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('crm_proposals', v_count);
  end if;

  -- CAMPANHAS: o que foi DITO à pessoa e o endereço para onde foi.
  update campaign_recipients set
    rendered_body = null,
    recipient_address = null,
    variables = '{}'::jsonb,
    last_error_detail = null,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('campaign_recipients', v_count);

  -- LISTA DE EXCLUSÃO: solta o vínculo e apaga a cauda do telefone.
  update campaign_suppressions set
    address_tail = null,
    reason = null,
    contact_id = null
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('campaign_suppressions', v_count);

  -- 6c. sales — a comanda. PRESERVA valor, status e datas, e NÃO desliga o
  --     contato (ver racional completo no baseline, bloco desta função).
  update sales set
    notes = null,
    cancel_reason = case when cancel_reason is null then null else '[redigido]' end,
    reverse_reason = case when reverse_reason is null then null else '[redigido]' end,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('sales', v_count);

  -- Capital Code: o anexo da nota interna (0483) não foi portado — sem a coluna,
  -- só o TEXTO da nota é redigido (que é dado sobre o titular do mesmo jeito).
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'conversation_notes'
                and column_name = 'media_storage_path') then
    -- 6d. conversation_notes (migration 0483, F3 da #1863) — a nota interna é
    -- texto escrito SOBRE a pessoa durante o atendimento, e o anexo dela é mídia
    -- ancorada na conversa: os dois entram no alcance do titular. A 0477 já
    -- mostrou o desenho (arquivo vai para a fila ANTES de a coluna ser zerada).
    -- O bucket é `internal-media`, e não o do passo 7: a nota nunca sobe no
    -- `whatsapp-media` (é o bucket do canal do CLIENTE), e enfileirar o caminho
    -- num bucket onde ele não está deixaria a remoção apontando para o nada —
    -- a mesma falha de não ter anonimizado, um endereço mais para a direita.
    -- Por isso os caminhos de nota também NÃO entram em `v_media_paths`: essa
    -- lista só existe para o passo 7, que enfileira `whatsapp-media`.
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'internal-media', n.media_storage_path
      from conversation_notes n
     where n.organization_id = p_organization_id
       and n.conversation_id in (
         select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
       )
       and n.media_storage_path is not null and length(n.media_storage_path) > 0
       and n.media_storage_path like p_organization_id::text || '/%'
    on conflict (bucket, object_path) do nothing;
    update conversation_notes set
      body = '[nota interna anonimizada]',
      media_storage_path = null,
      media_mime = null,
      media_size_bytes = null
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
         where contact_id = p_contact_id and organization_id = p_organization_id
      );
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('conversation_notes', v_count);
  else
    update conversation_notes set
      body = '[nota interna anonimizada]'
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
         where contact_id = p_contact_id and organization_id = p_organization_id
      );
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('conversation_notes', v_count);
  end if;

  -- 7. enqueue media for async deletion (idempotent via unique (bucket, object_path))
  if array_length(v_media_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'whatsapp-media', path
      from unnest(v_media_paths) as path
      where path is not null and length(path) > 0
    on conflict (bucket, object_path) do nothing;
  end if;

  -- 7b. voice_calls — o TELEFONE de quem falou ao telefone (migration 0235).
  update voice_calls set
    peer_phone = v_anon_label,
    owner_user_id = null,
    created_by = null,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('voice_calls', v_count);

  update prospecting_candidates set suppression_salt = gen_random_bytes(32)
  where organization_id = p_organization_id
    and (contact_id = p_contact_id
         or (phone is not null
             and regexp_replace(phone, '\D', '', 'g') = any (v_variantes)))
    and suppression_salt is null;
  update prospecting_candidates set
    suppression_place = hmac(convert_to(place_id, 'UTF8'), suppression_salt, 'sha256'),
    suppression_phone = case when phone is null then null
      else hmac(convert_to(phone, 'UTF8'), suppression_salt, 'sha256') end,
    place_id = 'redacted:' || id::text,
    phone = null,
    data = jsonb_build_object('key', 'redacted:' || id::text,
      'name', v_anon_label, 'phone', null, 'website', null,
      'category', null, 'address', null, 'maps_url', null,
      'rating', null, 'reviews', null, 'emails', '[]'::jsonb, 'socials', '[]'::jsonb),
    status = 'skipped', service_boundary = null, error = null, updated_at = now()
  where organization_id = p_organization_id
    and (contact_id = p_contact_id
         or (phone is not null
             and regexp_replace(phone, '\D', '', 'g') = any (v_variantes)));
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('prospecting_candidates', v_count);

  -- agent_cases — o que a IA escreveu SOBRE a pessoa quando travou (migration 0280).
  update agent_cases set
    title = v_anon_label,
    summary = '[resumo anonimizado]',
    blocker = '[bloqueio anonimizado]',
    context_snapshot = '{}'::jsonb
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('agent_cases', v_count);

  -- agent_case_events — a linha do tempo do caso (migration 0280).
  update agent_case_events set
    body = null,
    metadata = '{}'::jsonb
  where organization_id = p_organization_id
    and case_id in (
      select id from agent_cases
        where organization_id = p_organization_id
          and conversation_id in (
            select id from conversations
              where contact_id = p_contact_id and organization_id = p_organization_id
          )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('agent_case_events', v_count);

  -- demandas — o assunto do pedido (migration 0280).
  update demandas set
    assunto = null
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('demandas', v_count);

  -- agent_inbox_items — o aviso que leva o texto do caso para a Central (migration 0280/0292).
  update agent_inbox_items set
    status = 'resolved',
    resolved_at = now(),
    body = 'Contato anonimizado.',
    ref_id = null
  where organization_id = p_organization_id
    and kind in ('handoff', 'case_stale', 'aviso_de_caso_nao_entregue')
    and (
      (ref_kind = 'contact' and ref_id = p_contact_id)
      or (ref_kind = 'conversation' and ref_id in (
            select id from conversations
              where contact_id = p_contact_id and organization_id = p_organization_id
          ))
      or (ref_kind = 'agent_case' and ref_id in (
            select id from agent_cases
              where organization_id = p_organization_id
                and conversation_id in (
                  select id from conversations
                    where contact_id = p_contact_id and organization_id = p_organization_id
                )
          ))
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('agent_inbox_items', v_count);

  -- agent_case_chat_messages — a consulta interna da equipe à IA SOBRE o caso (migration 0281).
  update agent_case_chat_messages set
    body = null,
    redacted_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id
    and redacted_at is null;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('agent_case_chat_messages', v_count);

  -- passagens_de_atendimento — o BRIEFING é sobre a pessoa (migration 0291).
  update passagens_de_atendimento set
    body       = v_anon_label,
    title      = null,
    notes      = null,
    content    = null,
    tentativas = '[]'::jsonb
  where organization_id = p_organization_id and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('passagens_de_atendimento', v_count);

  -- entregas_de_aviso_de_caso — o registro do aviso ao suporte (migration 0292).
  update entregas_de_aviso_de_caso set
    erro_detalhe = null
  where organization_id = p_organization_id
    and case_id in (
      select id from agent_cases
        where organization_id = p_organization_id
          and conversation_id in (
            select id from conversations
              where contact_id = p_contact_id and organization_id = p_organization_id
          )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('entregas_de_aviso_de_caso', v_count);

  -- Capital Code: grupos na inbox (0482) não foi portado — só se a tabela existe.
  if to_regclass('public.channel_session_groups') is not null then
    -- channel_session_groups.subject — o NOME do grupo, e a FK contact_id aponta
    -- para o placeholder do grupo (contacts.kind = 'whatsapp_group'), nunca para
    -- o titular real sendo anonimizado neste caminho — mas a FK para contacts e o
    -- nome da coluna casam o padrão automático do escopo (migration 0482), e
    -- nulificar não perde nada operacional: número, conversa e liga/desliga ficam.
    update public.channel_session_groups set
      subject = null
    where organization_id = p_organization_id
      and contact_id = p_contact_id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('channel_session_groups', v_count);
  end if;

  -- 8005: as fichas FUNDIDAS neste contato (fn_mesclar_contatos) guardam o nome,
  -- o telefone e o que mais tinham antes da fusão. Anonimizar o titular alcança
  -- cada uma, na mesma organização, pela MESMA cascata — com a própria linha de
  -- auditoria e o que estiver fundido nelas (fusão de fusão). A fusão seguida é
  -- a que tem data; a ficha já anonimizada não é revisitada, o que também
  -- encerra qualquer ciclo.
  for v_fundida in
    select c.id from contacts c
     where c.organization_id = p_organization_id and c.is_merged_into = p_contact_id
       and c.merged_at is not null and not c.is_anonymized and c.id <> p_contact_id
     order by c.id
  loop
    v_sub := public.fn_lgpd_cascade_redact_contact(p_organization_id, v_fundida, p_request_id);
    v_fundidas := v_fundidas || jsonb_build_array(jsonb_build_object('contact_id', v_fundida, 'counts', v_sub->'counts'));
    v_media_paths := v_media_paths || coalesce(array(select jsonb_array_elements_text(v_sub->'media_paths')), '{}');
  end loop;
  v_counts := v_counts || jsonb_build_object('fichas_fundidas', jsonb_array_length(v_fundidas));

  -- 8. dense audit row
  insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
  values (
    p_organization_id,
    'lgpd.redact_executed',
    null,
    'contact',
    p_contact_id,
    jsonb_build_object(
      'cascaded_to', v_counts,
      'media_queued', coalesce(array_length(v_media_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths,
    'fichas_fundidas', v_fundidas
  );
end;
$$;

revoke execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid) to service_role;

-- Fusão e anonimização são escritas pelas funções do servidor (`fn_mesclar_contatos`
-- e a cascata, ambas `security definer`), nunca pela sessão. Sem isto, um membro
-- com escrita em `contacts` desfaria a anonimização pela REST
-- (`is_anonymized = false`), ou desligaria a ficha da fusão para escapar da
-- cascata. O alvo é o papel da sessão: dentro das funções definer o papel é o dono.
create or replace function public.fn_contacts_fusao_e_anonimizacao_so_pelo_servidor()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'contacts_fusao_e_anonimizacao_so_pelo_servidor'
      using errcode = '42501',
            detail = 'Fusão e anonimização passam por fn_mesclar_contatos e fn_lgpd_anonymize_contact.';
  end if;
  return new;
end $$;
revoke execute on function public.fn_contacts_fusao_e_anonimizacao_so_pelo_servidor() from public, anon, authenticated, service_role;

drop trigger if exists trg_contacts_fusao_e_anonimizacao_so_pelo_servidor on public.contacts;
create trigger trg_contacts_fusao_e_anonimizacao_so_pelo_servidor
  before update on public.contacts
  for each row
  when (old.is_merged_into is distinct from new.is_merged_into
     or old.merged_at is distinct from new.merged_at
     or old.is_anonymized is distinct from new.is_anonymized
     or old.anonymized_at is distinct from new.anonymized_at)
  execute function public.fn_contacts_fusao_e_anonimizacao_so_pelo_servidor();

drop trigger if exists trg_contacts_fusao_e_anonimizacao_so_pelo_servidor_ao_criar on public.contacts;
create trigger trg_contacts_fusao_e_anonimizacao_so_pelo_servidor_ao_criar
  before insert on public.contacts
  for each row
  when (new.is_merged_into is not null
     or new.merged_at is not null
     or new.anonymized_at is not null
     or new.is_anonymized)
  execute function public.fn_contacts_fusao_e_anonimizacao_so_pelo_servidor();

-- Dados: as fichas fundidas em contatos que JÁ estavam anonimizados. A ficha
-- alcançada leva as que estão abaixo dela pela própria cascata. Repetir não
-- acha ninguém.
do $fichas_absorvidas$
declare
  v_ficha record;
begin
  for v_ficha in
    select a.organization_id, a.id
      from public.contacts a
      join public.contacts s
        on s.id = a.is_merged_into and s.organization_id = a.organization_id
     where s.is_anonymized and not a.is_anonymized and a.merged_at is not null
     order by a.organization_id, a.id
  loop
    perform public.fn_lgpd_cascade_redact_contact(v_ficha.organization_id, v_ficha.id, null);
  end loop;
end
$fichas_absorvidas$;
