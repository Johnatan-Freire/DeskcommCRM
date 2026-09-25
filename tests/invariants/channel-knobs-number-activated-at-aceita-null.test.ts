import { describe, expect, it } from "vitest";

import { sql, lastLine } from "./gov-helpers";

/**
 * migration 0402 — `channel_knobs.number_activated_at` deixa de ser NOT NULL.
 *
 * `pacingKnobsUpdateSchema` (lib/ai/pacing-knobs.ts) sempre tratou `null`
 * como estado válido ("idade desconhecida" — o motor usa o degrau mais
 * conservador de warm-up). Antes da 0402, um UPDATE com `number_activated_at
 * = null` — exatamente o que o PUT /api/v1/ai/pacing manda quando o campo
 * opcional da tela fica em branco — era recusado pela constraint NOT NULL
 * (23502), mesmo com o payload da aplicação sendo o esperado.
 */
describe("channel_knobs.number_activated_at aceita NULL", () => {
  it("UPDATE com number_activated_at = null não é mais recusado pela constraint (23502)", () => {
    const org = "eeee0000-0000-4000-8000-0000000000e1";
    const session = "eeee0000-0000-4000-8000-0000000000e2";
    sql(`
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${org}', 'channel-knobs-0402-fixture', 'Channel Knobs 0402', 'Channel Knobs 0402')
        on conflict (id) do nothing;
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${session}', '${org}', 'channel-knobs-0402-fixture', '\\x00'::bytea)
        on conflict (id) do nothing;
      insert into public.channel_knobs (organization_id, channel_session_id, number_activated_at)
        values ('${org}', '${session}', now())
        on conflict (organization_id, channel_session_id) do nothing;
    `);
    // A prova real: o UPDATE que o PUT manda quando o campo fica em branco.
    sql(`update public.channel_knobs set number_activated_at = null where channel_session_id = '${session}';`);
    const valor = lastLine(
      sql(`select number_activated_at from public.channel_knobs where channel_session_id = '${session}';`),
    );
    expect(valor).toBe("");
  });
});
