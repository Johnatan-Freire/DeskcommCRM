-- 0275: channel_knobs.number_activated_at aceita NULL — a coluna nasceu
-- `not null default now()` (migration 0050), mas a camada de aplicação
-- (lib/ai/pacing-knobs.ts, AntiBanSheet.tsx, lib/agent-engine/pacing/engine.ts)
-- sempre tratou `null` como um estado válido e DISTINTO de "ativado agora":
-- significa "idade desconhecida", e o motor de pacing usa isso para tratar o
-- número como o degrau MAIS conservador de warm-up permanentemente — não só
-- no primeiro dia (`ageDays = state.numberActivatedAt ? floor(...) : 0`).
--
-- A UI expõe "Número em uso desde" como campo OPCIONAL, com texto explicando
-- que deixar em branco é um estado esperado. Só que o PUT /api/v1/ai/pacing
-- manda `number_activated_at: null` explicitamente quando o campo está vazio
-- — e null explícito ignora o DEFAULT do Postgres, então a constraint NOT
-- NULL rejeitava (23502) TODO salvamento da tela de Proteção de envio em que
-- esse campo opcional ficasse em branco. Achado ao testar a janela de envio
-- cruzando meia-noite (22h-07h) em produção: a própria tela recusava salvar
-- mesmo sem tocar o campo problemático, porque o form sempre reenvia o
-- payload inteiro.
alter table public.channel_knobs
  alter column number_activated_at drop not null;
