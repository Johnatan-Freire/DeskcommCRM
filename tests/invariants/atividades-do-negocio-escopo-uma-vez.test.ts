import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * `crm_lead_activities_select` e `crm_lead_links_select` calculam o escopo do
 * usuário UMA vez por consulta (migration 8003), e continuam deixando ver
 * exatamente o que o negócio-pai deixa ver por `fn_can_view_lead`.
 *
 * O defeito, medido em produção em 13/11/2026: a policy fazia
 * `exists (… crm_leads l … and fn_can_view_lead(l.organization_id, l.owner_user_id))`.
 * Para a ficha de UM contato, o planejador montava o conjunto de negócios
 * visíveis chamando a função para todos os 348 negócios da organização:
 * 1.061 ms por abertura, 4,5% do tempo total do banco.
 *
 * Duas provas, como a de `funil-escopo-uma-vez-por-consulta.test.ts`:
 *   - EQUIVALÊNCIA: numa matriz de papel × `visibility_mode` × dono, a filha
 *     visível pela RLS é exatamente a filha cujo negócio-pai a função aprova.
 *   - CUSTO: dobrar os negócios não muda quantas vezes `fn_user_role_in_org`
 *     é chamada ao ler as filhas. Com a policy antiga, dobra junto.
 *
 * Namespace próprio (a7e5…) para rodar em paralelo com os outros invariantes.
 */

const id = (grupo: string, n: number) =>
  `a7e50000-${grupo}-4000-8000-${String(n).padStart(12, "0")}`;

const ORGS = {
  all: id("0001", 1),
  ou: id("0001", 2),
  own: id("0001", 3),
  padrao: id("0001", 4), // sem `visibility_mode` → own_and_unassigned
  estranho: id("0001", 5), // valor desconhecido → nada além do próprio
} as const;

const USERS = {
  agente: id("0002", 1), // agent em TODAS as orgs
  outro: id("0002", 2), // agent em todas, dono dos negócios "de outro"
  viewer: id("0002", 3), // viewer em own
  manager: id("0002", 4), // manager em own
  admin: id("0002", 5), // admin em ou
  plataforma: id("0002", 6), // admin de plataforma, sem vínculo
  revogado: id("0002", 7), // agent revogado em all
  fora: id("0002", 8), // sem vínculo nenhum
  misto: id("0002", 9), // agent em own + viewer em ou
} as const;
type User = keyof typeof USERS;

const DONOS = ["agente", "outro", null] as const;
const LEAD = "a7e50000-0004-";
const ATIVIDADE = "a7e50000-0005-";
const VINCULO = "a7e50000-0006-";

function seed(): string {
  const orgs = Object.entries(ORGS)
    .map(([k, o]) => {
      const settings =
        k === "padrao"
          ? "'{}'::jsonb"
          : `jsonb_build_object('visibility_mode', '${
              { all: "all", ou: "own_and_unassigned", own: "own", estranho: "xyz" }[k]
            }')`;
      return `('${o}', 'a7e5-${k}', 'A7e5 ${k}', 'A7e5 ${k}', ${settings})`;
    })
    .join(",\n");

  const vinculos: string[] = [];
  for (const o of Object.values(ORGS)) {
    vinculos.push(`('${USERS.agente}', '${o}', 'agent', now(), null)`);
    vinculos.push(`('${USERS.outro}', '${o}', 'agent', now(), null)`);
  }
  vinculos.push(`('${USERS.viewer}', '${ORGS.own}', 'viewer', now(), null)`);
  vinculos.push(`('${USERS.manager}', '${ORGS.own}', 'manager', now(), null)`);
  vinculos.push(`('${USERS.admin}', '${ORGS.ou}', 'admin', now(), null)`);
  vinculos.push(`('${USERS.revogado}', '${ORGS.all}', 'agent', now(), now())`);
  vinculos.push(`('${USERS.misto}', '${ORGS.own}', 'agent', now(), null)`);
  vinculos.push(`('${USERS.misto}', '${ORGS.ou}', 'viewer', now(), null)`);

  const funis: string[] = [];
  const etapas: string[] = [];
  const leads: string[] = [];
  const atividades: string[] = [];
  const links: string[] = [];
  let n = 0;
  Object.entries(ORGS).forEach(([, o], i) => {
    const funil = id("0003", i + 1);
    const etapa = id("0007", i + 1);
    funis.push(`('${funil}', '${o}', 'A7e5 ${i}', 'a7e5-funil-${i}', 1)`);
    etapas.push(`('${etapa}', '${o}', '${funil}', 'Entrada', 'a7e5-entrada-${i}', 1)`);
    for (const dono of DONOS) {
      n += 1;
      const lead = id("0004", n);
      const responsavel = dono ? `'${USERS[dono]}'` : "null";
      leads.push(`('${lead}', '${o}', '${funil}', '${etapa}', 'A7e5 ${n}', 'open', ${responsavel})`);
      atividades.push(`('${id("0005", n)}', '${o}', '${lead}', 'agent', 'handoff_triggered')`);
      links.push(`('${id("0006", n)}', '${o}', '${lead}', 'external', '${id("0008", n)}', 'reference')`);
    }
  });

  return `
    insert into auth.users (id, email) values
      ${Object.entries(USERS)
        .map(([k, u]) => `('${u}', 'a7e5-${k}@invariant.test')`)
        .join(",\n")}
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ${orgs}
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at) values
      ${vinculos.join(",\n")}
      on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      values ('${USERS.plataforma}', '${USERS.plataforma}', 'full', false, 'invariante a7e5')
      on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug, position) values
      ${funis.join(",\n")}
      on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ${etapas.join(",\n")}
      on conflict do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, owner_user_id) values
      ${leads.join(",\n")}
      on conflict do nothing;
    insert into public.crm_lead_activities (id, organization_id, lead_id, source_module, type) values
      ${atividades.join(",\n")}
      on conflict do nothing;
    insert into public.crm_lead_links (id, organization_id, lead_id, target_kind, target_id, link_kind) values
      ${links.join(",\n")}
      on conflict do nothing;
  `;
}

const claims = (u: string) =>
  `select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', false);`;

const FILHAS = [
  { tabela: "crm_lead_activities", prefixo: ATIVIDADE, policy: "crm_lead_activities_select" },
  { tabela: "crm_lead_links", prefixo: VINCULO, policy: "crm_lead_links_select" },
] as const;
type Filha = (typeof FILHAS)[number];

/** As filhas cujo negócio-pai a FUNÇÃO aprova, medido como dono da tabela (sem RLS). */
function aprovadasPelaFuncao(f: Filha, u: string): string {
  return lastLine(
    sql(`
      ${claims(u)}
      select 'ids:' || coalesce(string_agg(c.id::text, ',' order by c.id), '')
        from public.${f.tabela} c
        join public.crm_leads l on l.id = c.lead_id
       where c.id::text like '${f.prefixo}%'
         and public.fn_can_view_lead(l.organization_id, l.owner_user_id);
    `),
  );
}

/** O que a RLS deixa ver da filha, como `authenticated`. */
function visiveisPelaRls(f: Filha, u: string): string {
  return lastLine(
    sql(`
      set role authenticated;
      ${claims(u)}
      select 'ids:' || coalesce(string_agg(id::text, ',' order by id), '')
        from public.${f.tabela}
       where id::text like '${f.prefixo}%';
    `),
  );
}

/** Sentinela `ids:` porque zero linhas viram string vazia, e `lastLine` pularia para a linha anterior. */
const ids = (saida: string) => {
  if (!saida.startsWith("ids:")) throw new Error(`saída inesperada do psql: ${saida}`);
  return saida.slice(4);
};
const quantas = (lista: string) => (lista === "" ? 0 : lista.split(",").length);

beforeAll(() => {
  sql(seed());
});

// A contagem esperada por usuário torna a equivalência não-vazia: se as duas
// réguas devolvessem nada, a igualdade passaria sem provar coisa nenhuma.
// Uma filha por negócio, então é a mesma conta do funil:
//   agente: all 3 + ou 2 + own 1 + padrao 2 + estranho 1 = 9
//   misto:  own 0 (agent em `own` e dono de nada) + ou 3 (viewer) = 3
const esperado: Record<User, number> = {
  agente: 9,
  outro: 9,
  viewer: 3,
  manager: 3,
  admin: 3,
  plataforma: 15,
  revogado: 0,
  fora: 0,
  misto: 3,
};

for (const f of FILHAS) {
  describe(`${f.policy} ≡ fn_can_view_lead do negócio-pai`, () => {
    for (const u of Object.keys(USERS) as User[]) {
      it(`${u}: a RLS mostra exatamente o que a função aprova (${esperado[u]})`, () => {
        const funcao = ids(aprovadasPelaFuncao(f, USERS[u]));
        const rls = ids(visiveisPelaRls(f, USERS[u]));
        expect(rls).toBe(funcao);
        expect(quantas(rls)).toBe(esperado[u]);
      });
    }

    it("a policy não chama mais fn_can_view_lead por linha", () => {
      const qual = lastLine(
        sql(`select replace(pg_get_expr(polqual, polrelid), E'\\n', ' ') from pg_policy
              where polrelid = 'public.${f.tabela}'::regclass and polname = '${f.policy}';`),
      );
      expect(qual).not.toContain("fn_can_view_lead");
      expect(qual).toContain("fn_escopo_de_conversas");
    });
  });
}

describe("custo: o escopo é calculado por consulta, não por negócio", () => {
  /**
   * Chamadas de `fn_user_role_in_org` feitas por UMA leitura das atividades
   * como `agente`. `pg_stat_get_xact_function_calls` lê o contador da própria
   * transação, sem depender do flush assíncrono das estatísticas.
   */
  function chamadasNaLeitura(extra: string): number {
    const out = sql(`
      begin;
      set local track_functions = 'all';
      ${extra}
      select coalesce(pg_stat_get_xact_function_calls('public.fn_user_role_in_org(uuid)'::regprocedure), 0);
      set local role authenticated;
      ${claims(USERS.agente)}
      select count(*) from public.crm_lead_activities where id::text like '${ATIVIDADE}%';
      reset role;
      select coalesce(pg_stat_get_xact_function_calls('public.fn_user_role_in_org(uuid)'::regprocedure), 0);
      rollback;
    `);
    const numeros = out.split("\n").filter((l) => /^\d+$/.test(l));
    const antes = Number(numeros[0]);
    const depois = Number(numeros[numeros.length - 1]);
    return depois - antes;
  }

  it("dobrar os negócios não muda o número de chamadas", () => {
    const base = chamadasNaLeitura("");
    // O caso medido em produção: a leitura é de uma ficha só, mas a policy
    // antiga avaliava a função em todos os negócios da organização. Dobrar os
    // negócios (sem atividade nova) só mudaria o número se o custo fosse por
    // negócio.
    const dobrados = chamadasNaLeitura(`
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, owner_user_id)
        select ('a7e50000-0004-4000-8000-' || lpad((100 + row_number() over (order by l.id))::text, 12, '0'))::uuid,
               l.organization_id, l.pipeline_id, l.stage_id, 'A7e5 dobro', l.status, l.owner_user_id
          from public.crm_leads l where l.id::text like '${LEAD}%';
    `);
    expect(base).toBeGreaterThan(0);
    expect(dobrados).toBe(base);
  });
});
