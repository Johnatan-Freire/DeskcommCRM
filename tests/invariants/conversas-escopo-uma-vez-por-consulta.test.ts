import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * `conversations_select` calcula o escopo do usuário UMA vez por consulta
 * (migration 0560), e continua deixando ver exatamente o que
 * `fn_can_view_conversation` deixa.
 *
 * O defeito: a policy chamava `fn_can_view_conversation` por linha — definer,
 * nunca embutida — e cada chamada rodava `fn_user_role_in_org` duas vezes (com
 * `fn_support_context` dentro). Medido em produção: 609 ms para contar 86
 * conversas como admin comum; as seis contagens do Inbox com média de 1,8 s.
 *
 * Duas provas, e as duas são necessárias:
 *   - EQUIVALÊNCIA: numa matriz de papel × `visibility_mode` × dono, o conjunto
 *     que a RLS deixa ver é o conjunto em que a função diz `true`. Otimizar
 *     policy de isolamento sem esta prova é trocar velocidade por vazamento.
 *   - CUSTO: dobrar as linhas não muda quantas vezes `fn_user_role_in_org` é
 *     chamada. Com a policy antiga, dobra junto.
 *
 * Namespace próprio (e5c0…) para rodar em paralelo com os outros invariantes.
 */

const id = (grupo: string, n: number) =>
  `e5c00000-${grupo}-4000-8000-${String(n).padStart(12, "0")}`;

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
const PREFIXO = "e5c00000-0004-";

function seed(): string {
  const orgs = Object.entries(ORGS)
    .map(([k, o]) => {
      const settings =
        k === "padrao"
          ? "'{}'::jsonb"
          : `jsonb_build_object('visibility_mode', '${
              { all: "all", ou: "own_and_unassigned", own: "own", estranho: "xyz" }[k]
            }')`;
      return `('${o}', 'e5c0-${k}', 'E5c0 ${k}', 'E5c0 ${k}', ${settings})`;
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

  const sessoes: string[] = [];
  const contatos: string[] = [];
  const conversas: string[] = [];
  let n = 0;
  Object.entries(ORGS).forEach(([, o], i) => {
    const sessao = id("0003", i + 1);
    sessoes.push(`('${sessao}', '${o}', 'e5c0-${i}', '\\x00'::bytea)`);
    for (const dono of DONOS) {
      n += 1;
      const contato = id("0005", n);
      contatos.push(`('${contato}', '${o}', 'E5c0 ${n}')`);
      const atribuido = dono ? `'${USERS[dono]}'` : "null";
      conversas.push(
        `('${id("0004", n)}', '${o}', '${contato}', '${sessao}', 'open', ${atribuido})`,
      );
    }
  });

  return `
    insert into auth.users (id, email) values
      ${Object.entries(USERS)
        .map(([k, u]) => `('${u}', 'e5c0-${k}@invariant.test')`)
        .join(",\n")}
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ${orgs}
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at) values
      ${vinculos.join(",\n")}
      on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      values ('${USERS.plataforma}', '${USERS.plataforma}', 'full', false, 'invariante e5c0')
      on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ${sessoes.join(",\n")}
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ${contatos.join(",\n")}
      on conflict do nothing;
    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id) values
      ${conversas.join(",\n")}
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
        from public.conversations
       where id::text like '${PREFIXO}%'
         and public.fn_can_view_conversation(organization_id, assigned_to_user_id);
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
        from public.conversations
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

describe("conversations_select ≡ fn_can_view_conversation", () => {
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

  it("a policy não chama mais fn_can_view_conversation por linha", () => {
    const qual = lastLine(
      sql(`select replace(pg_get_expr(polqual, polrelid), E'\\n', ' ') from pg_policy
            where polrelid = 'public.conversations'::regclass and polname = 'conversations_select';`),
    );
    expect(qual).not.toContain("fn_can_view_conversation");
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
      select count(*) from public.conversations where id::text like '${PREFIXO}%';
      reset role;
      select coalesce(pg_stat_get_xact_function_calls('public.fn_user_role_in_org(uuid)'::regprocedure), 0);
      rollback;
    `);
    const numeros = out.split("\n").filter((l) => /^\d+$/.test(l));
    const antes = Number(numeros[0]);
    const depois = Number(numeros[numeros.length - 1]);
    return depois - antes;
  }

  it("dobrar as conversas não muda o número de chamadas", () => {
    const base = chamadasNaContagem("");
    // Mesma distribuição (org × dono), o dobro de linhas: os mesmos subplanos
    // são construídos, então só uma avaliação POR LINHA mudaria o número.
    const dobradas = chamadasNaContagem(`
      insert into public.contacts (id, organization_id, display_name)
        select ('e5c00000-0006-4000-8000-' || lpad(row_number() over (order by c.id)::text, 12, '0'))::uuid,
               c.organization_id, 'E5c0 dobro'
          from public.conversations c where c.id::text like '${PREFIXO}%';
      insert into public.conversations
        (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id)
        select ('e5c00000-0004-4000-8000-' || lpad((100 + row_number() over (order by c.id))::text, 12, '0'))::uuid,
               c.organization_id,
               ('e5c00000-0006-4000-8000-' || lpad(row_number() over (order by c.id)::text, 12, '0'))::uuid,
               c.channel_session_id, c.status, c.assigned_to_user_id
          from public.conversations c where c.id::text like '${PREFIXO}%';
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

