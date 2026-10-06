import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { FILTRO_VAZIO, type FiltroDeAudiencia } from "./audiencia";
import { buscarCandidatos } from "./consulta-de-audiencia";

/**
 * `{{lead.x}}` NÃO PODE DERRUBAR A PREPARAÇÃO NEM PERDER O NEGÓCIO MAIS NOVO.
 *
 * A primeira versão punha os ids de TODA a audiência num único
 * `contact_id=in.(…)`: com a audiência padrão de 500 contatos a URL tinha
 * ~19,7 KB, e o gateway (Kong 2.8.1) devolve `414` acima de 8.192 B — a
 * preparação inteira caía. E o `.limit(n*4)` global cortava quem tem o negócio
 * mais antigo. Aqui a URL sai do `postgrest-js` de verdade e um PostgREST falso
 * aplica filtro, ordem, `offset/limit` e o corte de `max_rows`.
 */

const MURO_DO_GATEWAY = 8_192;
const MAX_ROWS = 1_000;
const uuid = (i: number, p = "1111") => `${String(i).padStart(8, "0")}-${p}-4111-8111-111111111111`;
const ORG = uuid(999, "9999");

interface Negocio {
  id: string;
  contact_id: string;
  created_at: string;
  custom_fields: Record<string, unknown>;
}

function json(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Um PostgREST de mentira, com o comportamento que importa aqui. */
function bancoFalso(contatos: string[], negocios: Negocio[], criados: Record<string, string> = {}) {
  const urls: string[] = [];
  /** Ordem ordinal — a mesma do `ORDER BY` do Postgres para estes campos. */
  const ord = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  // Ordenações pré-computadas: o handler roda uma vez por página/lote, e
  // reordenar a base inteira a cada requisição deixaria os casos grandes lentos.
  const contatosOrdenados = contatos
    .map((id, i) => ({ id, created_at: criados[id] ?? quando(i) }))
    .sort((a, b) => ord(a.created_at, b.created_at) || ord(a.id, b.id));
  const negociosOrdenados = [...negocios].sort(
    (a, b) => ord(a.created_at, b.created_at) || ord(a.id, b.id),
  );
  const sb = createClient("http://127.0.0.1:54321", "x".repeat(200), {
    global: {
      fetch: async (entrada: RequestInfo | URL) => {
        const bruta = String(entrada);
        urls.push(bruta);
        const url = new URL(bruta);
        if (url.pathname.endsWith("/contacts")) {
          // Filtro de `id=in.(…)`, ordem (`created_at`, `id`) e página
          // (`offset`/`limit`, com o teto de `max_rows`): é o recorte que a
          // consulta de contatos usa. Os outros filtros (tags, origem, datas)
          // não são modelados de propósito — o que se mede aqui é o TAMANHO da
          // URL e a ordem/corte global, não a semântica de cada um.
          const filtroIds = url.searchParams.getAll("id").find((v) => v.startsWith("in."));
          const permitidos = filtroIds ? new Set(filtroIds.slice(4, -1).split(",")) : null;
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limite = Math.min(Number(url.searchParams.get("limit") ?? MAX_ROWS), MAX_ROWS);
          const linhas = contatosOrdenados
            .filter((c) => !permitidos || permitidos.has(c.id))
            .slice(offset, offset + limite)
            .map((c) => ({
              id: c.id,
              created_at: c.created_at,
              name: "Ana Souza",
              display_name: null,
              phone_number: "5511999990000",
              is_blocked: false,
              is_anonymized: false,
              consent: null,
            }));
          return json(linhas);
        }
        const filtroIn = url.searchParams.getAll("contact_id").find((v) => v.startsWith("in."));
        if (!filtroIn) {
          // A consulta dos IDs de negócio do recorte (`select=contact_id`, sem
          // `in (…)`): devolve LINHAS — com repetição — ordenadas e paginadas
          // como o PostgREST faz. O corte de `max_rows` é o que o #2402 mede.
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limite = Math.min(Number(url.searchParams.get("limit") ?? MAX_ROWS), MAX_ROWS);
          return json(
            negociosOrdenados
              .slice(offset, offset + limite)
              .map((n) => ({ contact_id: n.contact_id })),
          );
        }
        const ids = new Set(filtroIn.slice(4, -1).split(","));
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limite = Math.min(Number(url.searchParams.get("limit") ?? MAX_ROWS), MAX_ROWS);
        const linhas = negocios
          .filter((n) => ids.has(n.contact_id))
          .sort((a, b) => ord(b.created_at, a.created_at) || ord(b.id, a.id))
          .slice(offset, offset + limite)
          .map(({ contact_id, custom_fields }) => ({ contact_id, custom_fields }));
        return json(linhas);
      },
    },
  });
  return {
    sb,
    urls,
    urlsDeNegocio: () => urls.filter((u) => u.includes("/crm_leads")),
    urlsDeContatos: () => urls.filter((u) => u.includes("/contacts")),
  };
}

/** Toda consulta do caminho, lote por lote, leva o filtro de organização. */
function cercaDeOrganizacao(banco: ReturnType<typeof bancoFalso>) {
  expect(banco.urls.length).toBeGreaterThan(0);
  for (const u of banco.urls) expect(u).toContain(`organization_id=eq.${ORG}`);
}

const quando = (minutos: number) => new Date(Date.UTC(2026, 0, 1) + minutos * 60_000).toISOString();

async function candidatos(sb: ReturnType<typeof bancoFalso>["sb"]) {
  return buscarCandidatos(sb, {
    organizationId: ORG,
    filtro: { ...FILTRO_VAZIO, limite: 5000 },
    agora: new Date(Date.UTC(2026, 5, 1)),
    corpo: "Oi {{nome}}, {{lead.gancho}}",
  });
}

describe("negócios dos contatos para {{lead.x}}", () => {
  it("a sonda ENXERGA o estouro: os 500 ids numa URL só passam do muro — controle positivo", async () => {
    const { sb, urls } = bancoFalso([], []);
    const ids = Array.from({ length: 500 }, (_, i) => uuid(i));
    await sb.from("crm_leads").select("contact_id, custom_fields").in("contact_id", ids);
    expect(urls[0]!.length).toBeGreaterThan(MURO_DO_GATEWAY);
  });

  it("audiência de 500: mais de uma consulta, nenhuma URL acima do muro, e todo mundo acha o seu negócio", async () => {
    const contatos = Array.from({ length: 500 }, (_, i) => uuid(i));
    const negocios = contatos.map((c, i) => ({
      id: uuid(i, "2222"),
      contact_id: c,
      created_at: quando(i),
      custom_fields: { gancho: `gancho ${i}` },
    }));
    const banco = bancoFalso(contatos, negocios);

    const lista = await candidatos(banco.sb);

    const urls = banco.urlsDeNegocio();
    expect(urls.length, "os ids foram numa consulta só").toBeGreaterThan(1);
    for (const u of urls) expect(u.length).toBeLessThan(MURO_DO_GATEWAY);
    expect(lista).toHaveLength(500);
    expect(lista.filter((c) => c.lead?.gancho === undefined)).toEqual([]);
    expect(lista[499]!.lead?.gancho).toBe("gancho 499");
  });

  it("contato com muitos negócios no mesmo lote não esconde o mais novo do vizinho", async () => {
    // A tem 1.500 negócios recentes; o único negócio de B é mais antigo que todos.
    // Um `.limit` global, ou o corte de `max_rows` sem paginar, devolve só os de A.
    const [a, b] = [uuid(1), uuid(2)];
    const negocios: Negocio[] = Array.from({ length: 1500 }, (_, i) => ({
      id: uuid(i, "3333"),
      contact_id: a,
      created_at: quando(10_000 + i),
      custom_fields: { gancho: `a ${i}` },
    }));
    negocios.push(
      { id: uuid(1, "4444"), contact_id: b, created_at: quando(5), custom_fields: { gancho: "b velho" } },
      { id: uuid(2, "4444"), contact_id: b, created_at: quando(6), custom_fields: { gancho: "b novo" } },
    );
    const banco = bancoFalso([a, b], negocios);

    const lista = await candidatos(banco.sb);

    expect(lista.find((c) => c.contactId === a)?.lead?.gancho).toBe("a 1499");
    expect(lista.find((c) => c.contactId === b)?.lead?.gancho).toBe("b novo");
  });
});

describe("recorte de funil grande não estoura a URL (#2358)", () => {
  const comFunil = (extra: Partial<FiltroDeAudiencia>) => ({
    ...FILTRO_VAZIO,
    funis: [uuid(900, "8888")],
    ...extra,
  });

  it("a sonda ENXERGA o estouro na consulta de contatos — controle positivo", async () => {
    const { sb, urls } = bancoFalso([], []);
    const ids = Array.from({ length: 500 }, (_, i) => uuid(i));
    await sb.from("contacts").select("id").in("id", ids);
    expect(urls[0]!.length).toBeGreaterThan(MURO_DO_GATEWAY);
  });

  it("funil com 500 contatos: consulta fatiada, nenhuma URL acima do muro, ordem global preservada", async () => {
    const contatos = Array.from({ length: 500 }, (_, i) => uuid(i));
    // Os negócios vêm EMBARALHADOS de propósito: a ordem da resposta só pode
    // vir da ordenação global da consulta, não da ordem dos lotes.
    const negocios = [...contatos]
      .reverse()
      .map((c, i) => ({ id: uuid(i, "2222"), contact_id: c, created_at: quando(i), custom_fields: {} }));
    const banco = bancoFalso(contatos, negocios);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: comFunil({ limite: 500 }),
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    const urls = banco.urlsDeContatos();
    expect(urls.length, "os ids foram numa consulta só").toBeGreaterThan(1);
    for (const u of urls) expect(u.length).toBeLessThan(MURO_DO_GATEWAY);
    expect(lista.map((c) => c.contactId)).toEqual(contatos);
    cercaDeOrganizacao(banco);
  });

  it("o corte global atravessa lotes: `limite` recorta a união ordenada, não cada lote", async () => {
    const n = 250;
    const contatos = Array.from({ length: n }, (_, i) => uuid(i));
    // `created_at` numa permutação da ordem da lista: os 50 mais velhos ficam
    // espalhados por lotes diferentes.
    const criados: Record<string, string> = {};
    contatos.forEach((c, i) => {
      criados[c] = quando((i * 97) % n);
    });
    const negocios = [...contatos]
      .reverse()
      .map((c, i) => ({ id: uuid(i, "2222"), contact_id: c, created_at: quando(i), custom_fields: {} }));
    const banco = bancoFalso(contatos, negocios, criados);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: comFunil({ limite: 50 }),
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    const esperado = [...contatos]
      .sort((a, b) => criados[a]!.localeCompare(criados[b]!) || a.localeCompare(b))
      .slice(0, 50);
    expect(lista).toHaveLength(50);
    expect(lista.map((c) => c.contactId)).toEqual(esperado);
    for (const u of banco.urlsDeContatos()) expect(u.length).toBeLessThan(MURO_DO_GATEWAY);
    cercaDeOrganizacao(banco);
  });

  it("excluídos saem da URL e são cortados ANTES do limite (caminho com funil)", async () => {
    const contatos = Array.from({ length: 200 }, (_, i) => uuid(i));
    const negocios = contatos.map((c, i) => ({
      id: uuid(i, "2222"),
      contact_id: c,
      created_at: quando(i),
      custom_fields: {},
    }));
    const banco = bancoFalso(contatos, negocios);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: comFunil({ limite: 50, excluir_contatos: contatos.slice(0, 40) }),
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    // O corte é DEPOIS da exclusão: os 50 primeiros VÁLIDOS, não 10 + buraco.
    expect(lista.map((c) => c.contactId)).toEqual(contatos.slice(40, 90));
    for (const u of banco.urlsDeContatos()) expect(u).not.toContain("not.in");
    cercaDeOrganizacao(banco);
  });

  it("o mesmo corte com exclusão vale sem filtro de negócio (consulta paginada)", async () => {
    const contatos = Array.from({ length: 200 }, (_, i) => uuid(i));
    const banco = bancoFalso(contatos, []);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: { ...FILTRO_VAZIO, com_alguma_tag: ["vip"], limite: 50, excluir_contatos: contatos.slice(0, 40) },
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    expect(lista.map((c) => c.contactId)).toEqual(contatos.slice(40, 90));
    for (const u of banco.urlsDeContatos()) expect(u).not.toContain("not.in");
    cercaDeOrganizacao(banco);
  });

  it("incluídos à mão também vão em lotes (até 5.000 ids), sem URL acima do muro", async () => {
    const contatos = Array.from({ length: 500 }, (_, i) => uuid(i));
    const banco = bancoFalso(contatos, []);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: { ...FILTRO_VAZIO, com_alguma_tag: ["vip"], limite: 50, incluir_contatos: contatos },
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    // 50 do recorte + os 450 que faltavam, em lotes de 100.
    expect(lista).toHaveLength(500);
    const urls = banco.urlsDeContatos();
    expect(urls.length).toBeGreaterThanOrEqual(6);
    for (const u of urls) expect(u.length).toBeLessThan(MURO_DO_GATEWAY);
    cercaDeOrganizacao(banco);
  });

  it("incluído repetido em lotes diferentes entra UMA vez", async () => {
    const contatos = Array.from({ length: 300 }, (_, i) => uuid(i));
    const banco = bancoFalso(contatos, []);
    // 150 ids fora do recorte; o da posição 120 repete o da posição 10, e os
    // dois caem em lotes diferentes de 100.
    const incluir = contatos.slice(100, 250);
    incluir[120] = incluir[10]!;

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: { ...FILTRO_VAZIO, com_alguma_tag: ["vip"], limite: 1, incluir_contatos: incluir },
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    const ids = lista.map((c) => c.contactId);
    expect(ids.filter((id) => id === incluir[10])).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(1 + 149);
    cercaDeOrganizacao(banco);
  });

  it("a ordem global é a do Postgres: segundo exato antes do fracionário do mesmo segundo", async () => {
    // `localeCompare` (colação ICU) põe `.` antes de `+` e invertia este par. Os
    // dois ficam em lotes diferentes, para que só a ordenação global decida.
    const contatos = Array.from({ length: 150 }, (_, i) => uuid(i));
    const criados: Record<string, string> = {};
    contatos.forEach((c, i) => {
      criados[c] = quando(100_000 + i);
    });
    criados[contatos[5]!] = "2026-01-01T12:34:56.5+00:00";
    criados[contatos[120]!] = "2026-01-01T12:34:56+00:00";
    const negocios = contatos.map((c, i) => ({
      id: uuid(i, "2222"),
      contact_id: c,
      created_at: quando(i),
      custom_fields: {},
    }));
    const banco = bancoFalso(contatos, negocios, criados);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: comFunil({ limite: 1 }),
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    expect(lista.map((c) => c.contactId)).toEqual([contatos[120]]);
    cercaDeOrganizacao(banco);
  });
});

describe("a consulta de ids de negócio pagina pelo max_rows (#2402)", () => {
  const comFunil = (extra: Partial<FiltroDeAudiencia>) => ({
    ...FILTRO_VAZIO,
    funis: [uuid(900, "8888")],
    ...extra,
  });

  it("funil com 1.200 negócios: duas páginas e a audiência sai inteira", async () => {
    const contatos = Array.from({ length: 1200 }, (_, i) => uuid(i));
    const negocios = contatos.map((c, i) => ({
      id: uuid(i, "2222"),
      contact_id: c,
      created_at: quando(i),
      custom_fields: {},
    }));
    const banco = bancoFalso(contatos, negocios);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: comFunil({ limite: 1200 }),
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    const urls = banco.urlsDeNegocio();
    expect(urls, "a consulta de ids não paginou").toHaveLength(2);
    expect(urls[0]).toContain("offset=0");
    expect(urls[1]).toContain("offset=1000");
    expect(lista.map((c) => c.contactId)).toEqual(contatos);
    cercaDeOrganizacao(banco);
  });

  it("o teto de 20.000 LINHAS continua teto: para na 20ª página, e não no max_rows", async () => {
    // 20.001 linhas para 100 contatos: o teto é por LINHA de negócio (o
    // `.limit(20_000)` de antes), não por contato distinto. Sem o corte no
    // teto, sairia uma 21ª página; com ele, a união para na vigésima.
    const contatos = Array.from({ length: 100 }, (_, i) => uuid(i));
    const negocios = Array.from({ length: 20_001 }, (_, i) => ({
      id: uuid(i, "2020"),
      contact_id: contatos[i % 100]!,
      created_at: quando(i),
      custom_fields: {},
    }));
    const banco = bancoFalso(contatos, negocios);

    const lista = await buscarCandidatos(banco.sb, {
      organizationId: ORG,
      filtro: comFunil({ limite: 5000 }),
      agora: new Date(Date.UTC(2026, 5, 1)),
    });

    expect(banco.urlsDeNegocio(), "paginou além do teto").toHaveLength(20);
    expect(lista).toHaveLength(100);
    cercaDeOrganizacao(banco);
  });
});
