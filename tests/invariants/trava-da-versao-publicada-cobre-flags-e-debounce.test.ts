/**
 * A TRAVA DA VERSÃO PUBLICADA COBRE `proposal_ai_draft_enabled` E `inbound_debounce_ms`
 * (migration 0503, issue #2003, PR #2013 de @webtecnica).
 *
 * O teste unitário do PR lê o TEXTO da última definição do trigger no
 * baseline. Este cobra o mesmo no Postgres, com o baseline aplicado, nos dois
 * sentidos que o texto não alcança:
 *
 *  1. editar qualquer uma das duas colunas numa versão PUBLICADA é recusado,
 *     e o valor gravado não muda;
 *  2. o caminho certo — rascunho novo com o valor novo, publicado pela
 *     `fn_publish_ai_agent_version` — continua funcionando: o trigger não
 *     pode travar a troca de STATUS (a anterior vira `superseded`).
 *
 * Os valores do UPDATE são diferentes do default de propósito (default de
 * `proposal_ai_draft_enabled` é TRUE; de `inbound_debounce_ms`, NULL): um
 * UPDATE para o mesmo valor passa pelo `is distinct from` e mediria nada.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedGov } from "./gov-helpers";
import { replyFixture } from "../support/autonomia-fixture";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 5,
});

beforeAll(() => seedGov());
afterAll(() => pool.end());

// Fork Capital Code: a 0503 do fork protege as colunas DELE (o upstream cobria
// `proposal_ai_draft_enabled`, de propostas, que não existe aqui). O escopo do
// agente (comercial × acadêmico) e a permissão de mover o funil não podem mudar
// numa versão publicada — era um furo do fork fechado nesta integração.
const COLUNAS: Array<[string, unknown]> = [
  ["inbound_debounce_ms", 5000],
  ["service_scope", "academico"],
  ["can_update_lead_state", false],
];

async function linha(id: string) {
  return (
    await pool.query(
      "select status, inbound_debounce_ms, service_scope, can_update_lead_state from ai_agent_versions where id=$1",
      [id],
    )
  ).rows[0] as {
    status: string;
    inbound_debounce_ms: number | null;
    service_scope: string | null;
    can_update_lead_state: boolean | null;
  };
}

it.each(COLUNAS)("%s não muda numa versão PUBLICADA", async (coluna, valor) => {
  const f = await replyFixture(pool);
  const antes = await linha(f.version);
  expect(antes.status).toBe("published");

  await expect(
    pool.query(`update ai_agent_versions set ${coluna} = $2 where id = $1`, [f.version, valor]),
  ).rejects.toThrow(/imutável/);

  expect(await linha(f.version)).toEqual(antes);
});

it("o caminho de versão nova continua: rascunho com os valores novos publica, e a anterior vira superseded", async () => {
  const f = await replyFixture(pool);
  await pool.query("update channel_sessions set status='WORKING' where id=$1", [f.channel]);
  await pool.query("update ai_agents set published_version_id=$2 where id=$1", [f.agent, f.version]);

  // Fork Capital Code: sem provedor `custom` / `base_url` (provedor personalizado
  // não portado) — o rascunho reusa provedor, modelo e credencial da publicada.
  const credencial = randomUUID();
  await pool.query(
    `insert into ai_provider_credentials
       (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag,
        api_key_last4, validated_at, models_available)
     select $1, organization_id, 'anthropic', 'Anthropic', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea,
            '4242', now(), array['claude-sonnet-4-6']
       from ai_agent_versions where id = $2`,
    [credencial, f.version],
  );
  const rascunho = randomUUID();
  await pool.query(
    `insert into ai_agent_versions
       (id,organization_id,agent_id,version_number,system_prompt,provider,model,credential_id,channel_session_id,status)
     select $1, organization_id, agent_id, 2, 'Atenda quem chegar.', 'anthropic', 'claude-sonnet-4-6', $3, channel_session_id, 'draft'
       from ai_agent_versions where id = $2`,
    [rascunho, f.version, credencial],
  );
  // Rascunho é editável — senão ninguém configura nada.
  for (const [coluna, valor] of COLUNAS) {
    await pool.query(`update ai_agent_versions set ${coluna} = $2 where id = $1`, [rascunho, valor]);
  }

  await pool.query("select * from fn_publish_ai_agent_version($1,$2,$3,false)", [
    f.org,
    f.agent,
    rascunho,
  ]);

  expect(await linha(rascunho)).toEqual({
    status: "published",
    inbound_debounce_ms: 5000,
    service_scope: "academico",
    can_update_lead_state: false,
  });
  expect((await linha(f.version)).status).toBe("superseded");
});
