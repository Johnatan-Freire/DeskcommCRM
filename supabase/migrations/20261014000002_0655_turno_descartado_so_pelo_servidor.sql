-- manifest: **O evento `turn_discarded` do follow-up é só do servidor (porte da seção G da 0501 do upstream, sem a suspensão de empresa).** O turno de envio descartado — inscrição pausada quando ele rodou (#2277) ou interrompido por quem assumiu a conversa (#2541) — grava `turn_discarded`, e o motor enfileira um turno NOVO no nó quando a inscrição volta a andar (`turnoDaAcaoDescartado` em `lib/followup/node-handlers.ts`). A policy `followup_enrollment_events_insert` deixa `manager` inserir pela sessão, e a chave `…:descartado` não termina em `:<n>`: sem esta guarda, um manager forjaria o evento pelo PostgREST e o motor enfileiraria um segundo turno de envio. `fn_followup_generation_write` é a definição VIGENTE do fork com UMA mudança: o ramo da trilha também recusa `event_type = 'turn_discarded'` quando há `auth.uid()`. O servidor (service_role, worker) não tem `auth.uid()` e segue gravando. Idempotente (`create or replace`).
-- O evento `turn_discarded` do follow-up é só do servidor (porte da seção G da 0501 do upstream).

create or replace function public.fn_followup_generation_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- #1862 — DELETE que chega em CASCATA não é escrita de follow-up. Este gatilho
 -- é BEFORE ROW: o DELETE vindo de `on delete cascade` roda sob o gatilho da
 -- chave estrangeira, com `pg_trigger_depth() > 1`. Passa QUALQUER cascata, não
 -- só a da ficha: apagar o contato, a inscrição (followup_enrollments), o fluxo
 -- (followup_flow_pointers) ou a organização leva junto os registros internos.
 -- O turno que sobra sem inscrição/evento falha fechado em
 -- fn_followup_job_current. A profundidade não distingue cascata de DELETE
 -- feito por outro gatilho: hoje nenhum gatilho apaga nestas duas tabelas, e
 -- quem criar um herda esta passagem. O DELETE DIRETO (profundidade 1, com
 -- `auth.uid()`) continua caindo na recusa abaixo — a 42501 não afrouxa.
 if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
 if tg_table_name='job_queue' then
  if auth.uid() is not null and ((tg_op<>'DELETE' and new.kind='followup_turn') or (tg_op<>'INSERT' and old.kind='followup_turn')) then
   raise exception 'followup_job_internal' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.kind='followup_turn' then
   if new.organization_id<>old.organization_id or new.contact_id is distinct from old.contact_id or new.kind<>old.kind
    or new.payload->'followup_enrollment_id' is distinct from old.payload->'followup_enrollment_id'
    or new.payload->'node_id' is distinct from old.payload->'node_id'
    or new.payload->'source_step_key' is distinct from old.payload->'source_step_key'
   then raise exception 'followup_job_origin_immutable' using errcode='42501'; end if;
  end if;
 elsif auth.uid() is not null and (
   (tg_op<>'DELETE' and (new.idempotency_key ~ ':[0-9]+$' or new.event_type='turn_discarded'))
   or (tg_op<>'INSERT' and (old.idempotency_key ~ ':[0-9]+$' or old.event_type='turn_discarded'))) then
  raise exception 'followup_step_internal' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;

revoke all on function public.fn_followup_generation_write() from public,anon,authenticated;

notify pgrst, 'reload schema';
