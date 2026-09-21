-- ============================================================================
-- 0281 — O AGENTE NÃO PODE RESPONDER MENSAGEM DE ANTES DE CONECTAR
--
-- ═══ O RISCO ═══
--
-- WAHA/NOWEB (baileys) sincroniza histórico do WhatsApp Web multi-device ao
-- parear uma sessão nova: o mesmo webhook que entrega mensagem NOVA também
-- entrega mensagem ANTIGA, de dias ou semanas atrás, sem nenhum campo que
-- distinga as duas — `lib/waha/ingest.ts` grava as duas do mesmo jeito e
-- `lib/channels/pos-entrada.ts` pede despacho do agente para as duas, sem
-- distinção. Numa instalação em produção isso significa o agente respondendo
-- — com o texto de hoje — uma pergunta de semanas atrás, para um aluno ou
-- responsável que nem lembra tê-la feito. Achado ao preparar a conexão do
-- WhatsApp de um cliente real e barrado ANTES de conectar, por exigência
-- explícita do dono do produto: o despacho só pode valer para mensagem que
-- chegou a partir do momento da conexão, nunca para trás.
--
-- ═══ O CORTE ═══
--
-- `channel_sessions.first_connected_at`: grava, uma ÚNICA vez por sessão, o
-- instante em que ela primeiro ficou `WORKING`. `coalesce(new.first_connected_at,
-- now())` no trigger garante que reconexões (queda de rede, reinício do WAHA)
-- NÃO empurram a data para frente — o corte é a PRIMEIRA conexão, não a mais
-- recente, porque só a primeira sincroniza histórico.
--
-- Sessão que já está `WORKING` antes desta migration fica com a coluna NULL —
-- de propósito: não há como saber o instante real da conexão passada, e
-- inventar um retroagiria (ou adiantaria) o corte para instalação que já
-- atende clientes hoje sem problema nenhum. O guard em código trata NULL como
-- "sem corte" — comportamento IDÊNTICO ao de antes desta migration para quem já
-- está conectado. Só sessão que conectar A PARTIR DE AGORA ganha a proteção,
-- que é exatamente o caso que precisa dela: o pareamento que ainda vai
-- acontecer.
--
-- ═══ ONDE O CORTE É APLICADO ═══
--
-- Não aqui — em TypeScript, nos dois lugares que decidem se o agente responde:
-- `lib/agent-engine/edge/crm/drain.ts` (organização com agente publicado) e
-- `workers/ai-response-worker.ts` (organização sem agente publicado, caminho
-- pré-engine — issue #129). Os dois comparam `messages.sent_at` (o horário
-- REAL do WhatsApp, não o de chegada no nosso banco) contra
-- `channel_sessions.first_connected_at`. A mensagem CONTINUA sendo gravada e
-- aparece no CRM de qualquer jeito — só o despacho (a resposta automática) é
-- que não dispara.
--
-- Aditiva e idempotente: coluna nova (NULL não quebra nada existente), função
-- e trigger novos. Nenhuma linha existente muda.
-- ============================================================================

alter table public.channel_sessions
  add column if not exists first_connected_at timestamptz;

comment on column public.channel_sessions.first_connected_at is
  'Instante em que esta sessão ficou WORKING pela PRIMEIRA vez — gravado uma única vez (coalesce protege de reconexão empurrar a data). NULL em sessão que já estava WORKING antes da migration 0281: sem corte, mesmo comportamento de sempre. É o corte que lib/agent-engine/edge/crm/drain.ts e workers/ai-response-worker.ts usam para nunca despachar o agente numa mensagem sincronizada de antes da conexão.';

create or replace function public.fn_marcar_primeira_conexao()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'WORKING' then
    new.first_connected_at := coalesce(new.first_connected_at, now());
  end if;
  return new;
end;
$$;

-- Função de trigger não exige EXECUTE de quem dispara o INSERT/UPDATE — só o
-- gatilho a chama, e o gatilho corre com o privilégio de quem escreve a linha
-- (sempre service_role neste produto: as rotas de channel-sessions usam o
-- client admin). Nenhum caminho passa pelo PostgREST como RPC.
revoke execute on function public.fn_marcar_primeira_conexao() from public, anon, authenticated;
grant  execute on function public.fn_marcar_primeira_conexao() to service_role;

drop trigger if exists trg_channel_sessions_primeira_conexao on public.channel_sessions;
create trigger trg_channel_sessions_primeira_conexao
  before insert or update on public.channel_sessions
  for each row
  execute function public.fn_marcar_primeira_conexao();

comment on function public.fn_marcar_primeira_conexao() is
  'BEFORE INSERT OR UPDATE em channel_sessions: quando status vira WORKING, grava first_connected_at UMA vez (coalesce). Existe para dar ao TypeScript um corte estável contra o qual comparar messages.sent_at, sem depender de nenhuma rota específica lembrar de gravar a data — toda rota que já escreve status=WORKING (webhook do WAHA, onboarding, reconnect, cron de saúde) passa por aqui automaticamente.';

notify pgrst, 'reload schema';
