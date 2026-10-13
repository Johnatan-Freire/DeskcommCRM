import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * `crm_leads_select` calcula o escopo do usuário UMA vez por consulta
 * (migration 0656), e continua deixando ver exatamente o que
 * `fn_can_view_lead` deixa.
 *
 * O defeito (o mesmo da 0560 nas conversas): a policy chamava
 * `fn_can_view_lead` por linha — definer, nunca embutida — e cada chamada
 * rodava `fn_user_role_in_org` duas vezes (com `fn_support_context` dentro).
 * Em produção, o quadro do funil "Contatos" passava dos 10 s do cliente.
 *
 * Duas provas, e as duas são necessárias:
 *   - EQUIVALÊNCIA: numa matriz de papel × `visibility_mode` × dono, o conjunto
 *     que a RLS deixa ver é o conjunto em que a função diz `true`. Otimizar
 *     policy de isolamento sem esta prova é trocar velocidade por vazamento.
 *   - CUSTO: dobrar as linhas não muda quantas vezes `fn_user_role_in_org` é
 *     chamada. Com a policy antiga, dobra junto.
 *
 * Namespace próprio (f0e5…) para rodar em paralelo com os outros invariantes.
 */

const id = (grupo: string, n: number) =>
  `f0e50000-${grupo}-4000-8000-${String(n).padStart(12, "0")}`;

const ORGS = {
  all: id("0001", 1),
  ou: id("0001", 2),
  own: id("0001", 3),
  padrao: id("0001", 4), // sem `visibility_mode` → own_and_unassigned
  estranho: id("0001", 5), // valor desconhecido → nada além do próprio
} as const;
type Org = keyof typeof ORGS;

const USERS = {
  agente: id("0002", 1), // agent em TODAS as orgs
  outro: id("0002", 2), // agent em todas, dono das conversas "de outro"
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
const PREFIXO = "f0e50000-0004-";

function seed(): string {
  const orgs = Object.entries(ORGS)
    .map(([k, o]) => {
      const settings =
        k === "padrao"
          ? "'{}'::jsonb"
          : `jsonb_build_object('visibility_mode', '${
              { all: "all", ou: "own_and_unassigned", own: "own", estranho: "xyz" }[k]
            }')`;
      return `('${o}', 'f0e5-${k}', 'F0e5 ${k}', 'F0e5 ${k}', ${settings})`;
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
  let n = 0;
  Object.entries(ORGS).forEach(([, o], i) => {
    const funil = id("0003", i + 1);
    const etapa = id("0007", i + 1);
    funis.push(`('${funil}', '${o}', 'F0e5 ${i}', 'f0e5-funil-${i}', 1)`);
    etapas.push(`('${etapa}', '${o}', '${funil}', 'Entrada', 'f0e5-entrada-${i}', 1)`);
    for (const dono of DONOS) {
      n += 1;
      const responsavel = dono ? `'${USERS[dono]}'` : "null";
      leads.push(`('${id("0004", n)}', '${o}', '${funil}', '${etapa}', 'F0e5 ${n}', 'open', ${responsavel})`);
    }
  });

  return `
    insert into auth.users (id, email) values
      ${Object.entries(USERS)
        .map(([k, u]) => `('${u}', 'f0e5-${k}@invariant.test')`)
        .join(",\n")}
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ${orgs}
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at) values
      ${vinculos.join(",\n")}
      on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      values ('${USERS.plataforma}', '${USERS.plataforma}', 'full', false, 'invariante f0e5')
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
  `;
}

const claims = (u: string) =>
  `select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', false);`;

/** O que a FUNÇÃO aprova, medido como dono da tabela (sem RLS) com os claims do usuário. */
function aprovadasPelaFuncao(u: string): string {
  return lastLine(
    sql(`
      ${claims(u)}
      select 'ids:' || coalesce(string_agg(id::text, ',' order by id), '')
        from public.crm_leads
       where id::text like '${PREFIXO}%'
         and public.fn_can_view_lead(organization_id, owner_user_id);
    `),
  );
}

/** O que a RLS deixa ver, como `authenticated`. */
function visiveisPelaRls(u: string): string {
  return lastLine(
    sql(`
      set role authenticated;
      ${claims(u)}
      select 'ids:' || coalesce(string_agg(id::text, ',' order by id), '')
        from public.crm_leads
       where id::text like '${PREFIXO}%';
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

describe("crm_leads_select ≡ fn_can_view_lead", () => {
  // A contagem esperada por usuário torna a equivalência não-vazia: se as duas
  // réguas devolvessem nada, a igualdade passaria sem provar coisa nenhuma.
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

  for (const u of Object.keys(USERS) as User[]) {
    it(`${u}: a RLS mostra exatamente o que a função aprova (${esperado[u]})`, () => {
      const funcao = ids(aprovadasPelaFuncao(USERS[u]));
      const rls = ids(visiveisPelaRls(USERS[u]));
      expect(rls).toBe(funcao);
      expect(quantas(rls)).toBe(esperado[u]);
    });
  }

  it("a policy não chama mais fn_can_view_lead por linha", () => {
    const qual = lastLine(
      sql(`select replace(pg_get_expr(polqual, polrelid), E'\\n', ' ') from pg_policy
            where polrelid = 'public.crm_leads'::regclass and polname = 'crm_leads_select';`),
    );
    expect(qual).not.toContain("fn_can_view_lead");
    expect(qual).toContain("fn_escopo_de_conversas");
  });
});

describe("custo: o escopo é calculado por consulta, não por linha", () => {
  /**
   * Chamadas de `fn_user_role_in_org` feitas por UMA contagem como `agente`.
   * `pg_stat_get_xact_function_calls` lê o contador da própria transação, sem
   * depender do flush assíncrono das estatísticas.
   */
  function chamadasNaContagem(extra: string): number {
    const out = sql(`
      begin;
      set local track_functions = 'all';
      ${extra}
      select coalesce(pg_stat_get_xact_function_calls('public.fn_user_role_in_org(uuid)'::regprocedure), 0);
      set local role authenticated;
      ${claims(USERS.agente)}
      select count(*) from public.crm_leads where id::text like '${PREFIXO}%';
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
    const base = chamadasNaContagem("");
    // Mesma distribuição (org × dono), o dobro de linhas: os mesmos subplanos
    // são construídos, então só uma avaliação POR LINHA mudaria o número.
    const dobradas = chamadasNaContagem(`
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, owner_user_id)
        select ('f0e50000-0004-4000-8000-' || lpad((100 + row_number() over (order by l.id))::text, 12, '0'))::uuid,
               l.organization_id, l.pipeline_id, l.stage_id, 'F0e5 dobro', l.status, l.owner_user_id
          from public.crm_leads l where l.id::text like '${PREFIXO}%';
    `);
    expect(base).toBeGreaterThan(0);
    expect(dobradas).toBe(base);
  });
});

describe("grants", () => {
  it("anon não executa fn_escopo_de_conversas; authenticated executa", () => {
    const out = lastLine(
      sql(`select has_function_privilege('anon', 'public.fn_escopo_de_conversas()', 'execute')
                || ',' || has_function_privilege('authenticated', 'public.fn_escopo_de_conversas()', 'execute');`),
    );
    expect(out).toBe("false,true");
  });
});

