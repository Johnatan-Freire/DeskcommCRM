import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { loadPublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";
import { toolsDoSistemaEscolarNoTurno } from "@/lib/agent-engine/agent/sistema-escolar-gate";
import { capabilitiesOf } from "@/lib/channels/capabilities";

/**
 * T63 (Fase 3) — prova a configuração real do agente comercial da Capital Code
 * pelo caminho REAL: linha em Postgres → `loadPublishedAgentConfig` (o mesmo
 * loader que `inbound-turn.ts` chama em produção) → `PublishedAgentConfig`
 * real. Não instancia objeto TS pronto — o valor vem do banco, decifrado pela
 * mesma query SQL que roda em produção.
 *
 * T52 — a partir do MESMO agentConfig real, reconstrói o veredito de gating de
 * cada tool usando as MESMAS funções/predicados que `inbound-turn.ts` usa
 * (`toolsDoSistemaEscolarNoTurno`, `capabilitiesOf`, e os campos booleanos
 * triviais de `agentConfig`). Não reexecuta o handler de turno inteiro — esse
 * seam não existe isolado no repo. O que ESTE teste prova com certeza: a
 * configuração real da Capital Code, carregada pelo loader real, produz os
 * predicados de gating corretos — é a fatia determinística e honesta do que
 * T52 pede.
 *
 * Porte do fork (commit 4d746e825) para a arquitetura atual — `ai_knowledge_sources`
 * ganhou `agent_id uuid not null` e um CHECK de `source_type` mais estrito
 * desde o checkpoint do fork (`'documento'` não é mais um valor válido); o
 * INSERT abaixo usa `agent_id` + `source_type='faq'`, mesma convenção de
 * `tests/invariants/autonomia-preview-core.test.ts`.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "dddddddd-cc00-4000-8000-000000000001";
const SESSION = "dddddddd-cc00-4000-8000-000000000002";
const AGENT = "dddddddd-cc00-4000-8000-000000000003";
const VERSION = "dddddddd-cc00-4000-8000-000000000004";
const KNOWLEDGE_SOURCE = "dddddddd-cc00-4000-8000-000000000005";

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'capital-code-fixture-teste', 'Capital Code (fixture de teste)', 'Capital Code')
     on conflict (id) do nothing`,
    [ORG],
  );

  // Canal WAHA — usado pelo gate real de send_template (capabilitiesOf('waha')).
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted, provider)
     values ($1, $2, 'capital-code-fixture-session', 'WORKING', '\\x00'::bytea, 'waha')
     on conflict (id) do nothing`,
    [SESSION, ORG],
  );

  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt, kind)
     values ($1, $2, 'Capital Code – Atendimento (fixture de teste)', 'system', 'mcp_agent')
     on conflict (id) do nothing`,
    [AGENT, ORG],
  );

  // Material de conhecimento (Playbook/Apostila) — precisa existir pra search_knowledge
  // entrar no turno (o gate real é knowledgeSourceIds.length > 0 || activeKbVersionId != null).
  // `agent_id` é obrigatório no schema atual (ausente no checkpoint do fork).
  await pool.query(
    `insert into ai_knowledge_sources (id, organization_id, agent_id, source_type, name, status)
     values ($1, $2, $3, 'faq', 'Playbook Comercial — Capital Code (fixture)', 'ready')
     on conflict (id) do nothing`,
    [KNOWLEDGE_SOURCE, ORG, AGENT],
  );

  // A configuração EXATA pedida no item 7 da Fase 3: can_mark_won=false,
  // can_mark_lost=true, tool_ids=[] (sem crm_close_demand/MCP nenhuma),
  // sistema_escolar_tool_ids só com consultar_catalogo_cursos.
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model,
        channel_session_id, status, published_at,
        can_mark_won, can_mark_lost, tool_ids, sistema_escolar_tool_ids,
        knowledge_source_ids, cases_enabled, handoff_tool_enabled)
     values
       ($1, $2, $3, 1, 'system prompt V2.4 (fixture)', 'openai', 'gpt-4o-mini',
        $4, 'published', now(),
        false, true, '{}', array['consultar_catalogo_cursos'],
        array[$5]::uuid[], true, true)
     on conflict (id) do nothing`,
    [VERSION, ORG, AGENT, SESSION, KNOWLEDGE_SOURCE],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION, AGENT]);

  // org_sistema_escolar_config ATIVA — sem isto toolsDoSistemaEscolarNoTurno
  // devolve as duas tools desligadas mesmo com sistema_escolar_tool_ids marcado.
  await pool.query(
    `insert into org_sistema_escolar_config (organization_id, base_url, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active)
     values ($1, 'https://escola.example', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'test', true)
     on conflict (organization_id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("T63 — configuração real da Capital Code, carregada pelo loader real (DB → loader → agentConfig)", () => {
  it("can_mark_won=false chega como canMarkWon:false no agentConfig real", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect(config).not.toBeNull();
    expect(config?.canMarkWon).toBe(false);
  });

  it("can_mark_lost=true chega como canMarkLost:true no agentConfig real", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect(config?.canMarkLost).toBe(true);
  });

  it("tool_ids=[] chega como toolIds:[] — nenhuma tool MCP (crm_close_demand incluída) é elegível", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect(config?.toolIds).toEqual([]);
  });

  it("sistema_escolar_tool_ids contém SOMENTE consultar_catalogo_cursos", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect(config?.sistemaEscolarToolIds).toEqual(["consultar_catalogo_cursos"]);
  });
});

describe("T52 — toolset real do turno, derivado do agentConfig real via os predicados reais de gating", () => {
  it("consultar_catalogo_cursos: presente (org configurada + agente marcou)", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    const gate = toolsDoSistemaEscolarNoTurno({
      orgConfigurada: true, // org_sistema_escolar_config.is_active=true, inserido no beforeAll
      agentToolIds: config?.sistemaEscolarToolIds ?? null,
    });
    expect(gate.catalogo).toBe(true);
  });

  it("consultar_aluno_sistema_escolar: AUSENTE (não está em sistema_escolar_tool_ids)", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    const gate = toolsDoSistemaEscolarNoTurno({
      orgConfigurada: true,
      agentToolIds: config?.sistemaEscolarToolIds ?? null,
    });
    expect(gate.aluno).toBe(false);
  });

  it("crm_close_demand (e qualquer tool MCP): AUSENTE — o bloco MCP só monta quando toolIds.length > 0", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect(config).not.toBeNull();
    const mcpBlockEntra = (config?.toolIds.length ?? 0) > 0;
    expect(mcpBlockEntra).toBe(false);
  });

  it("send_template: AUSENTE no canal WAHA (capabilitiesOf('waha').requiresTemplates === false)", () => {
    expect(capabilitiesOf("waha").requiresTemplates).toBe(false);
  });

  it("open_human_case: presente (cases_enabled=true na versão publicada)", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect(config?.casesEnabled).toBe(true);
  });

  it("request_human_handoff: presente (handoff_tool_enabled default true, não desligado)", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect(config?.handoffToolEnabled).toBe(true);
  });

  it("search_knowledge: presente (knowledge_source_ids não vazio — Playbook cadastrado)", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION);
    expect((config?.knowledgeSourceIds.length ?? 0) > 0).toBe(true);
  });

  it("send_message, get_lead_context, update_lead_state, schedule_followup, save_lead_note, get_lead_note: core incondicional — nunca aparecem num `delete rawTools.<nome>` de inbound-turn.ts", () => {
    // Sem seam isolado pra provar isso via runtime — a garantia aqui é
    // estática e real: lê o arquivo de produção e confirma que nenhuma das 6
    // tools core é alvo de um `delete rawTools.<nome>` (o único mecanismo de
    // exclusão condicional que o arquivo usa — confirmado por grep no próprio
    // código-fonte).
    const fonte = readFileSync(
      join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
      "utf8",
    );
    const deletados = [...fonte.matchAll(/delete rawTools\.(\w+)/g)].map((m) => m[1]);
    const core = [
      "send_message",
      "get_lead_context",
      "update_lead_state",
      "schedule_followup",
      "save_lead_note",
      "get_lead_note",
    ];
    for (const tool of core) {
      expect(deletados).not.toContain(tool);
    }
  });
});
