-- manifest: **Reafirma `fn_appointment_change` na forma do baseline, para a cadeia de migrations chegar ao mesmo schema que a instalação.** A 0225 (`google_reconciliacao`) não aplica sobre o estado de instalação (`MIGRATIONS_QUE_NAO_RODAM`), e a última definição que a cadeia alcançava era a da 0224 — corpo diferente do wrapper que o baseline instala (delegando a `fn_appointment_change_core`). No upstream quem reafirma é a 0716 (agendas de serviços), não portada. Em produção nada muda: o banco atualizado pelo baseline já tem este corpo. Idempotente (`create or replace`, mesmos grants). Prova em `tests/invariants/baseline-e-cadeia-chegam-ao-mesmo-schema.test.ts`.
--
-- 8002 — fn_appointment_change igual nos dois caminhos de schema (faixa 8xxx do fork).

create or replace function public.fn_appointment_change(p_org uuid,p_id uuid,p_revision bigint,p_patch jsonb)
returns jsonb language sql security definer set search_path=public as $$
 select public.fn_appointment_change_core(p_org,p_id,p_revision,p_patch,false,null);
$$;
revoke all on function public.fn_appointment_change(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.fn_appointment_change(uuid,uuid,bigint,jsonb) to authenticated,service_role;
