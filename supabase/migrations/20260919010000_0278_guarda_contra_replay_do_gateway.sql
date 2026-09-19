-- ============================================================================
-- 0278 — GUARDA CONTRA REPLAY DE 5xx DO GATEWAY DO SUPABASE
--
-- Achado ao triar o CHANGELOG do upstream (melgarafael/DeskcommCRM, migration
-- 0237): em produção lá, o app inteiro respondeu "Algo deu errado" (503
-- PGRST002 em toda rota) com o Postgres saudável e ocioso. A causa: uma
-- função (deles, do motor de follow-up) que às vezes recusa com
-- `errcode='40001'` — um conflito BENIGNO, que o cliente sabe tratar. O
-- PostgREST mapeia a classe 40 (transaction_rollback) para HTTP 500, e a
-- camada do Supabase entre o Cloudflare e o PostgREST trata todo 5xx como
-- falha transitória e REEXECUTA sem limite. Oito requisições de DOIS DIAS
-- antes, reexecutadas ~280×/s cada, ocuparam o pool inteiro; o carregamento
-- do schema cache do PostgREST não conseguiu conexão e falhou — e uma falha
-- de carga do cache derruba TODA rota, inclusive a leitura mais trivial da
-- tela de login.
--
-- ─── Por que entra aqui, sem termos o bug que disparou lá ───────────────────
--
-- Não temos `errcode='40001'` em função nenhuma hoje (varrido: zero
-- ocorrências). Mas a guarda não depende disso — ela intercepta QUALQUER
-- reexecução do gateway, de QUALQUER erro 5xx futuro, de qualquer função. O
-- gatilho de origem é deles; a superfície que ela fecha (o gateway do
-- Supabase reexecutando resposta antiga até esgotar o pool) é nossa também,
-- porque é a MESMA infraestrutura hospedada. É defesa em profundidade pura:
-- aditiva, não toca nenhuma função existente, e o pior caso de a guarda errar
-- para o lado restritivo é um 409 a mais numa requisição que já expirou do
-- lado do cliente há muito tempo.
--
-- ─── O mecanismo ─────────────────────────────────────────────────────────────
--
-- Um hook `pgrst.db_pre_request` (o PostgREST o chama ANTES da query de toda
-- requisição, sob o papel da requisição). Ele lê o `sb-request-id` (UUIDv7,
-- carrega o instante de aceite) e, se esse instante tem mais de 5 minutos,
-- responde `PT409` → HTTP 409. Um 4xx não é reexecutado pelo gateway, e uma
-- requisição aceita há mais de 5 minutos não tem cliente esperando de
-- qualquer forma (timeouts de cliente/proxy são bem menores que isso).
--
-- Falha para o lado ABERTO em qualquer situação que não seja "id velho e
-- reconhecível": sem cabeçalho, cabeçalho fora do formato, ou erro interno da
-- própria guarda — todos passam. Uma guarda que pudesse derrubar requisição
-- legítima por defeito próprio seria pior que não ter guarda.
--
-- Idempotente (create or replace + grants explícitos); portável em psql puro.
-- ============================================================================

create or replace function public.fn_pgrst_recusar_replay_do_gateway()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  rid text;
  aceito_ha interval;
begin
  rid := coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'sb-request-id', '');
  -- Só UUIDv7 (versão 7 no 3º grupo) carrega instante; qualquer outro formato passa.
  if rid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-' then
    return;
  end if;
  aceito_ha := now() - to_timestamp((('x' || replace(left(rid, 13), '-', ''))::bit(48)::bigint) / 1000.0);
  if aceito_ha > interval '5 minutes' then
    raise exception 'gateway_replay'
      using errcode = 'PT409',
            detail  = format('sb-request-id %s foi aceito pelo gateway há %s', rid, aceito_ha),
            hint    = 'A requisição original já expirou; esta é uma reexecução do gateway de uma resposta 5xx antiga.';
  end if;
exception
  when sqlstate 'PT409' then
    raise;
  when others then
    -- A guarda nunca derruba uma requisição por defeito próprio (cabeçalho fora do esperado etc.).
    return;
end;
$$;

comment on function public.fn_pgrst_recusar_replay_do_gateway() is
  'pgrst.db_pre_request: responde 409 a requisição que o gateway do Supabase reexecuta há >5 min (sb-request-id UUIDv7 velho), para não alimentar o loop de retry de 5xx que esgota o pool do PostgREST.';

-- Roda sob o papel da REQUISIÇÃO (anon/authenticated/service_role), então os três
-- precisam de EXECUTE; sem isso a própria guarda vira "permission denied" → 5xx.
-- Não é definer e não lê nada além dos GUCs da requisição: expô-la não amplia nada.
revoke all on function public.fn_pgrst_recusar_replay_do_gateway() from public, anon;
grant execute on function public.fn_pgrst_recusar_replay_do_gateway() to anon, authenticated, service_role;

-- O papel `authenticator` só existe onde há PostgREST (Supabase). No Postgres
-- descartável do `test:db` não existe, e um ALTER ROLE sem guarda derrubaria o
-- install fresco (ON_ERROR_STOP=1).
do $$
begin
  if to_regrole('authenticator') is not null then
    execute $c$alter role authenticator set pgrst.db_pre_request = 'public.fn_pgrst_recusar_replay_do_gateway'$c$;
  end if;
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
