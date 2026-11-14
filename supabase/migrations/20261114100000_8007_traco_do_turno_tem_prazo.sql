-- 8007 — O traço do turno do agente ganha prazo: 90 dias (decisão do dono, 14/11/2026).
--
-- `agent_turn_traces` (0721) grava uma linha por resposta do agente e não tinha
-- poda nenhuma. Medido em produção em 14/11: ~18 turnos/dia, ~550/mês, banco de
-- 144 MB — o volume é pequeno, mas tabela sem prazo num Nano é dívida que só
-- cresce.
--
-- Porte dedicado da 9021 do upstream (#3516, @webtecnica), com duas diferenças
-- declaradas:
--   - prazo PRÓPRIO, `TURN_TRACE_RETENTION_DAYS` (padrão 90, piso 30). O
--     upstream reusa `AI_TELEMETRY_RETENTION_DAYS` (400/100) da 0587, que o
--     fork não tem;
--   - sem o leitor `/api/v1/ai/turn-traces` (o resto da entrega do upstream).
-- Mesmo NOME de função do upstream: um porte futuro da 9021 substitui o corpo
-- e, se vier com piso 100, ELEVA os 90 dias — quem portar decide o número.
--
-- Mesma forma da família de expurgos (0167, 0281, 0291, 0292, 0408):
-- `security definer` SEM seletor de linha (o único predicado vindo de fora é a
-- idade), piso no CORPO, lote com teto de 10000, execute só para service_role.

create index if not exists idx_agent_turn_traces_expurgo_created_at
  on public.agent_turn_traces (created_at);

create or replace function public.fn_expurgar_traco_do_turno_vencido(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- 90 = RETENCAO_TRACO_DO_TURNO_DIAS_PADRAO e 30 = _PISO (lib/retencao/politica.ts).
  -- Repetidos aqui de propósito: o piso vale para quem chama sem passar pelo
  -- TypeScript. O par é medido em tests/unit/retencao-todo-piso-tem-dono.test.ts.
  v_dias int := greatest(coalesce(p_retencao_dias, 90), 30);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_apagadas int;
begin
  -- O corte fica no `where` ANTES do `limit` (a lição da 0167).
  with vencidas as (
    select t.id from public.agent_turn_traces t
     where t.created_at < v_corte
     order by t.created_at limit v_limite
  )
  delete from public.agent_turn_traces t using vencidas v where t.id = v.id;
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;
revoke execute on function public.fn_expurgar_traco_do_turno_vencido(int,int) from public, anon, authenticated;
grant  execute on function public.fn_expurgar_traco_do_turno_vencido(int,int) to service_role;

notify pgrst, 'reload schema';
