-- 0276 — escopo do sistema escolar POR AGENTE, não só por organização
--
-- ═══ O PROBLEMA, MEDIDO ═══
--
-- As tools `consultar_aluno_sistema_escolar` e `consultar_catalogo_cursos`
-- (lib/agent-engine/agent/inbound-turn.ts) só entravam no turno quando a
-- organização tinha `org_sistema_escolar_config` ativa — mas, satisfeita essa
-- condição, QUALQUER agente publicado daquela organização ganhava as DUAS
-- juntas, sem distinção de papel. Um agente de vendas ("Interessados", que só
-- deveria cotar curso para quem ainda não é aluno) podia puxar nota e falta de
-- um aluno matriculado sabendo só o telefone dele; um agente de suporte
-- ("Alunos") podia cotar preço de curso sem que ninguém tivesse pedido isso.
--
-- ═══ A COLUNA VIVE NA VERSÃO, MESMO RACIOCÍNIO DA 0125 ═══
--
-- `ai_agent_versions`, não `ai_agents` nem a config da organização: o runtime
-- relê a versão PUBLICADA a cada turno, e um escopo fora do ciclo
-- rascunho→publicar mudaria o alcance do agente sem ninguém ter publicado
-- nada — pior ainda tratando-se de dado de aluno (nome, nota, financeiro).
--
-- ═══ NASCE FECHADO, POR DUAS ORIGENS — mesma fórmula de pipeline_ids/operator_tool_ids ═══
--
-- `default '{}'` cobre o agente novo; o `?? []` no runtime (agent-config.ts)
-- cobre o clone que ainda não aplicou esta migration. Vazio = NENHUMA das duas
-- tools — a direção segura é agir de menos.
--
-- Idempotente; sem BEGIN/COMMIT; psql puro.

alter table public.ai_agent_versions
  add column if not exists sistema_escolar_tool_ids text[] not null default '{}'::text[];

comment on column public.ai_agent_versions.sistema_escolar_tool_ids is
  'Quais das duas tools de sistema escolar (consultar_aluno_sistema_escolar, consultar_catalogo_cursos) ESTE agente pode usar. Vazio = NENHUMA: falha fechada. Só tem efeito quando a org também tem org_sistema_escolar_config ativa (gate em duas camadas, ver sistema-escolar-gate.ts).';

-- ---- backfill: o que JÁ funcionava continua funcionando ----
--
-- Antes desta coluna existir, TODO agente publicado numa org com a integração
-- ativa recebia as duas tools automaticamente — não havia como escolher menos.
-- "Agente novo nasce fechado" e "agente existente perde uma capacidade que já
-- usava, em silêncio, no dia do deploy" são coisas MUITO diferentes: sem este
-- backfill, o primeiro deploy desta migration faria a integração real da
-- Capital Code parar de responder pergunta de aluno até alguém abrir a tela
-- de cada agente e marcar os dois switches de novo.
--
-- Aplica a TODAS as versões (não só as de orgs com config ativa hoje): se uma
-- org ativar a integração DEPOIS, os agentes que já existiam devem continuar
-- se comportando como sempre se comportaram — as duas tools juntas — até que
-- alguém entre na tela e restrinja.
update public.ai_agent_versions
   set sistema_escolar_tool_ids = array['consultar_aluno_sistema_escolar', 'consultar_catalogo_cursos']
 where sistema_escolar_tool_ids = '{}'::text[];

-- ---- o trigger de imutabilidade para de ignorar a coluna nova ----
--
-- Mesmo conserto que a 0125 já fez para pipeline_ids: sem incluir a coluna
-- aqui, uma versão já PUBLICADA podia ter o escopo do sistema escolar trocado
-- por um UPDATE direto, sem virar versão nova e sem deixar trilha — um escopo
-- de PERMISSÃO editável em produção sem publicar nada.
create or replace function fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.sistema_escolar_tool_ids is distinct from old.sistema_escolar_tool_ids
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();
