/**
 * MATERIAIS DO AGENTE (migration 8006), contra Postgres real com o baseline que
 * o self-hoster aplica.
 *
 * Provas:
 *   - as duas consultas do TypeScript (`carregarMateriaisDoAgente` e
 *     `prepararMaterialDoAgente`) rodam contra o schema REAL: filtro por agente,
 *     inativo fora, e o reenvio barrado pela `metadata.material_id` da mensagem;
 *   - isolamento: membro lê só a própria organização; a sessão não escreve;
 *   - CHECKs: caminho do arquivo dentro da organização, tipo, tamanho;
 *   - o bucket privado existe com o teto de 16 MB e os quatro formatos.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { carregarMateriaisDoAgente } from "@/lib/ai/materiais-do-agente";
import { prepararMaterialDoAgente } from "@/lib/agent-engine/agent/material-do-agente";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 4,
});

const ORG = randomUUID();
const VIZINHA = randomUUID();
const MEMBRO = randomUUID();
const SESSAO = randomUUID();
const COMERCIAL = randomUUID();
const ALUNOS = randomUUID();

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}

async function material(o: { org?: string; titulo: string; agentes?: string[]; ativo?: boolean }): Promise<string> {
  const id = randomUUID();
  const org = o.org ?? ORG;
  await q(
    `insert into materiais_do_agente (id, organization_id, titulo, quando_enviar, tipo, storage_path, mime, tamanho_bytes, agente_ids, ativo)
     values ($1::uuid, $2::uuid, $3, 'quando o lead perguntar do curso', 'video', $2::text || '/' || $1::text || '.mp4', 'video/mp4', 1000, $4::uuid[], $5)`,
    [id, org, o.titulo, o.agentes ?? [], o.ativo ?? true],
  );
  return id;
}

beforeAll(async () => {
  await q(
    "insert into organizations (id, slug, legal_name, display_name) values ($1, $2, 'Escola', 'Escola'), ($3, $4, 'Vizinha', 'Vizinha')",
    [ORG, `mat-${ORG}`, VIZINHA, `mat-${VIZINHA}`],
  );
  await q("insert into auth.users (id, email) values ($1, $2)", [MEMBRO, `mat-${MEMBRO}@invariant.test`]);
  await q(
    "insert into user_organizations (user_id, organization_id, role, accepted_at) values ($1, $2, 'agent', now())",
    [MEMBRO, ORG],
  );
  await q(
    `insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status)
     values ($1, $2, $3, '\\x00'::bytea, 'WORKING')`,
    [SESSAO, ORG, `mat-${SESSAO}`],
  );
  for (const [id, nome] of [[COMERCIAL, "Comercial"], [ALUNOS, "Alunos"]] as const) {
    await q("insert into ai_agents (id, organization_id, name, system_prompt, kind) values ($1, $2, $3, 'p', 'mcp_agent')", [
      id, ORG, nome,
    ]);
  }
});
afterAll(async () => {
  await pool.end();
});

describe("o que cada agente vê (carregarMateriaisDoAgente, SQL real)", () => {
  it("material de todos + o do próprio agente; inativo e o de outro agente ficam fora", async () => {
    const todos = await material({ titulo: "Para todos" });
    const doComercial = await material({ titulo: "Do Comercial", agentes: [COMERCIAL] });
    const doAlunos = await material({ titulo: "Do Alunos", agentes: [ALUNOS] });
    const inativo = await material({ titulo: "Inativo", ativo: false });
    const daVizinha = await material({ org: VIZINHA, titulo: "Da vizinha" });

    const ids = (await carregarMateriaisDoAgente(pool, { organizationId: ORG, agentId: COMERCIAL })).map((m) => m.id);
    expect(ids).toContain(todos);
    expect(ids).toContain(doComercial);
    for (const fora of [doAlunos, inativo, daVizinha]) expect(ids).not.toContain(fora);
  });
});

describe("reenvio barrado pela mensagem que já levou o material (prepararMaterialDoAgente, SQL real)", () => {
  it("depois de uma mensagem com metadata.material_id, o mesmo material é recusado na conversa", async () => {
    const id = await material({ titulo: "Apresentação" });
    const contato = randomUUID();
    await q("insert into contacts (id, organization_id, display_name, phone_number) values ($1, $2, 'Lead', $3)", [
      contato, ORG, `+5561${Math.floor(Math.random() * 1e9)}`,
    ]);
    const conversa = randomUUID();
    await q(
      "insert into conversations (id, organization_id, contact_id, channel_session_id, status) values ($1, $2, $3, $4, 'open')",
      [conversa, ORG, contato, SESSAO],
    );
    const entrada = { tenantId: ORG, conversationId: conversa, materialId: id, agentId: COMERCIAL };

    expect(await prepararMaterialDoAgente(pool, null, entrada)).toMatchObject({ ok: true, titulo: "Apresentação" });

    // Mensagem que FALHOU não conta: o material pode sair de novo.
    await q(
      `insert into messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, sent_via, body, metadata)
       values ($1, $2, $3, $4, 'video', 'outbound', 'failed', 'ai', 'veja', jsonb_build_object('material_id', $5::text))`,
      [ORG, conversa, SESSAO, contato, id],
    );
    expect(await prepararMaterialDoAgente(pool, null, entrada)).toMatchObject({ ok: true });

    await q(
      `insert into messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, sent_via, body, metadata)
       values ($1, $2, $3, $4, 'video', 'outbound', 'sent', 'ai', 'veja', jsonb_build_object('material_id', $5::text))`,
      [ORG, conversa, SESSAO, contato, id],
    );
    expect(await prepararMaterialDoAgente(pool, null, entrada)).toMatchObject({ ok: false, code: "material_ja_enviado" });

    // Outra conversa não é afetada; a prévia (pasta `dry-run`, que não é uuid) também não quebra.
    expect(
      await prepararMaterialDoAgente(pool, null, { ...entrada, conversationId: "dry-run" }),
    ).toMatchObject({ ok: true });
  });

  it("material de outro agente, inativo ou de outra organização é recusado", async () => {
    const doAlunos = await material({ titulo: "Do Alunos", agentes: [ALUNOS] });
    const daVizinha = await material({ org: VIZINHA, titulo: "Da vizinha" });
    for (const id of [doAlunos, daVizinha, randomUUID()]) {
      expect(
        await prepararMaterialDoAgente(pool, null, { tenantId: ORG, conversationId: "dry-run", materialId: id, agentId: COMERCIAL }),
      ).toMatchObject({ ok: false, code: "material_nao_encontrado" });
    }
  });
});

describe("isolamento e superfície", () => {
  async function comoSessao<T>(usuario: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: usuario, role: "authenticated" }),
      ]);
      await c.query("set local role authenticated");
      return await fn(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  it("membro lê só a própria organização", async () => {
    await material({ titulo: "Meu" });
    await material({ org: VIZINHA, titulo: "Alheio" });
    const orgs = await comoSessao(MEMBRO, async (c) =>
      (await c.query<{ organization_id: string }>("select distinct organization_id from materiais_do_agente")).rows.map(
        (r) => r.organization_id,
      ),
    );
    expect(orgs).toEqual([ORG]);
  });

  it("a sessão não escreve; anon não tem nada", async () => {
    const [r] = await q<Record<string, boolean>>(
      `select has_table_privilege('authenticated', 'public.materiais_do_agente', 'INSERT') a_ins,
              has_table_privilege('authenticated', 'public.materiais_do_agente', 'UPDATE') a_upd,
              has_table_privilege('authenticated', 'public.materiais_do_agente', 'DELETE') a_del,
              has_table_privilege('authenticated', 'public.materiais_do_agente', 'SELECT') a_sel,
              has_table_privilege('anon', 'public.materiais_do_agente', 'SELECT') anon_sel,
              has_table_privilege('service_role', 'public.materiais_do_agente', 'INSERT') srv_ins`,
    );
    expect(r).toEqual({ a_ins: false, a_upd: false, a_del: false, a_sel: true, anon_sel: false, srv_ins: true });
  });

  it("CHECKs: arquivo fora da pasta da organização, tipo desconhecido e arquivo acima de 16 MB", async () => {
    const id = randomUUID();
    const insere = (caminho: string, tipo: string, tamanho: number) =>
      q(
        `insert into materiais_do_agente (id, organization_id, titulo, quando_enviar, tipo, storage_path, mime, tamanho_bytes)
         values ($1, $2, 't', 'quando o lead pedir', $3, $4, 'video/mp4', $5)`,
        [id, ORG, tipo, caminho, tamanho],
      );
    await expect(insere(`${VIZINHA}/${id}.mp4`, "video", 10)).rejects.toMatchObject({ code: "23514" });
    await expect(insere(`${ORG}/${id}.exe`, "video", 10)).rejects.toMatchObject({ code: "23514" });
    await expect(insere(`${ORG}/${id}.mp4`, "audio", 10)).rejects.toMatchObject({ code: "23514" });
    await expect(insere(`${ORG}/${id}.mp4`, "video", 16 * 1024 * 1024 + 1)).rejects.toMatchObject({ code: "23514" });
  });

  it("o bucket é privado, com teto de 16 MB e só MP4, JPEG, PNG e PDF", async () => {
    const [b] = await q<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'agent-materials'",
    );
    expect(b).toEqual({
      public: false,
      file_size_limit: String(16 * 1024 * 1024),
      allowed_mime_types: ["video/mp4", "image/jpeg", "image/png", "application/pdf"],
    });
  });
});
