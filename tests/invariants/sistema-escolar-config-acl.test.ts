import { describe, expect, it, beforeAll } from "vitest";

import { sql, lastLine, countAs, writeCountAs } from "./gov-helpers";

/**
 * migration 0399 — `org_sistema_escolar_config` guarda a chave de API (cifrada)
 * do sistema escolar externo de cada organização. A tela sempre lê/escreve
 * pelo admin client no servidor, então o SELECT de `authenticated`/`anon` foi
 * revogado desde a migration (nenhum caminho de browser precisa ler
 * `api_key_encrypted/iv/tag`). Prova comportamental exigida por
 * `tests/invariants/rls-completude-varredura.test.ts` (citada em PROVA_PROPRIA).
 *
 * ⚠️ MEDIDO, não deduzido do ACL: com o SELECT revogado, o Postgres recusa
 * QUALQUER `UPDATE`/`DELETE` com `WHERE`/`ON CONFLICT`/`RETURNING` que leia
 * uma coluna existente — "permission denied for table", antes mesmo de a RLS
 * ser avaliada — porque o padrão do SQL exige SELECT nas colunas referenciadas
 * fora do próprio SET, mesmo tendo UPDATE/DELETE concedidos pelo ACL default do
 * Supabase (`has_table_privilege('authenticated', …, 'UPDATE')` responde `t`).
 * Isso vale até para o admin escrever na PRÓPRIA linha: a única escrita que
 * `authenticated` alcança de verdade é um `INSERT` cego, sem `ON CONFLICT`, e
 * mesmo esse fica confinado pela policy
 * `tenant_isolation_org_sistema_escolar_config_write`
 * (`fn_user_org_ids()` + `fn_role_at_least(organization_id,'admin')`). Ou seja:
 * a superfície de escrita de `authenticated` nesta tabela é mais estreita do
 * que a RLS sozinha garantiria — e é exatamente essa superfície estreita, e não
 * uma suposição sobre o que "deveria" funcionar, que os testes abaixo medem.
 */

const ORG_A = "5e5c0000-0000-4000-8000-0000000000a1";
const ORG_B = "5e5c0000-0000-4000-8000-0000000000b1";
const ORG_C = "5e5c0000-0000-4000-8000-0000000000c1";
const ADMIN_A = "5e5c0000-1111-4000-8000-0000000000a1";
const ADMIN_B = "5e5c0000-1111-4000-8000-0000000000b1";

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

describe("org_sistema_escolar_config — ACL e RLS", () => {
  it("SELECT fica fora do alcance de anon/authenticated; RLS está ligada", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(
        valor(`select has_table_privilege('${role}', 'public.org_sistema_escolar_config', 'SELECT')`),
      ).toBe("f");
    }
    expect(
      valor(`select relrowsecurity from pg_class where oid = 'public.org_sistema_escolar_config'::regclass`),
    ).toBe("t");
  });

  describe("isolamento por organização (JWT real, não inspeção de policy)", () => {
    beforeAll(() => {
      sql(`
        insert into auth.users (id, email) values
          ('${ADMIN_A}', 'sistema-escolar-0399-admin-a@invariant.test'),
          ('${ADMIN_B}', 'sistema-escolar-0399-admin-b@invariant.test')
          on conflict do nothing;

        insert into public.organizations (id, slug, legal_name, display_name) values
          ('${ORG_A}', 'sistema-escolar-0399-a', 'Sistema Escolar 0399 A', 'Sistema Escolar 0399 A'),
          ('${ORG_B}', 'sistema-escolar-0399-b', 'Sistema Escolar 0399 B', 'Sistema Escolar 0399 B'),
          ('${ORG_C}', 'sistema-escolar-0399-c', 'Sistema Escolar 0399 C', 'Sistema Escolar 0399 C')
          on conflict do nothing;

        insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
          ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
          ('${ADMIN_A}', '${ORG_C}', 'admin', now()),
          ('${ADMIN_B}', '${ORG_B}', 'admin', now())
          on conflict do nothing;

        insert into public.org_sistema_escolar_config
            (organization_id, base_url, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4)
          values
            ('${ORG_A}', 'https://escola-a.example', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'aaaa'),
            ('${ORG_B}', 'https://escola-b.example', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'bbbb')
          on conflict (organization_id) do nothing;
      `);
      // ORG_C fica DE PROPÓSITO sem linha: é o alvo do INSERT cego positivo
      // abaixo, que precisa de uma organização sem conflito de PK para não
      // exigir ON CONFLICT (que, como o SELECT também, authenticated não tem).
    });

    it("SELECT direto por authenticated é recusado mesmo para o admin da própria organização", () => {
      expect(() =>
        countAs(ADMIN_A, `select count(*) from public.org_sistema_escolar_config where organization_id = '${ORG_A}'`),
      ).toThrow();
    });

    it("UPDATE/DELETE direto por authenticated é recusado por ACL — mesmo na PRÓPRIA organização", () => {
      // Sem SELECT, o Postgres recusa antes de a RLS entrar em jogo: o WHERE
      // (ou o RETURNING que o writeCountAs anexa) lê `organization_id`, e essa
      // leitura por si só já é negada. Não é "toThrow por RLS" — é "toThrow
      // por ACL", e é isso que a mensagem abaixo confirma.
      expect(() =>
        writeCountAs(
          ADMIN_A,
          `update public.org_sistema_escolar_config set base_url = 'https://tentativa-mesma-org.example' where organization_id = '${ORG_A}'`,
        ),
      ).toThrow(/permission denied/);
      expect(() =>
        writeCountAs(ADMIN_A, `delete from public.org_sistema_escolar_config where organization_id = '${ORG_A}'`),
      ).toThrow(/permission denied/);
      // A linha de A segue intacta.
      expect(valor(`select base_url from public.org_sistema_escolar_config where organization_id = '${ORG_A}'`)).toBe(
        "https://escola-a.example",
      );
    });

    it("INSERT cego (sem ON CONFLICT) do admin da organização A NÃO cria linha para a organização B — with check bloqueia", () => {
      expect(
        writeCountAs(
          ADMIN_A,
          `insert into public.org_sistema_escolar_config
             (organization_id, base_url, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4)
           values
             ('${ORG_B}', 'https://tentativa-cross-org.example', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'xxxx')`,
        ),
      ).toBe(0);
      // A linha de B segue a original — a negativa acima não é um "deny-all" disfarçado.
      expect(valor(`select base_url from public.org_sistema_escolar_config where organization_id = '${ORG_B}'`)).toBe(
        "https://escola-b.example",
      );
    });

    it("INSERT cego do admin NA PRÓPRIA organização é aceito — controle positivo (a policy não é deny-all)", () => {
      expect(
        writeCountAs(
          ADMIN_A,
          `insert into public.org_sistema_escolar_config
             (organization_id, base_url, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4)
           values
             ('${ORG_C}', 'https://escola-c.example', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'cccc')`,
        ),
      ).toBe(1);
      expect(valor(`select base_url from public.org_sistema_escolar_config where organization_id = '${ORG_C}'`)).toBe(
        "https://escola-c.example",
      );
    });
  });
});
