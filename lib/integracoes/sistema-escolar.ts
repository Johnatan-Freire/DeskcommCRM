/**
 * Integração com o sistema escolar (Laravel externo da Capital Code,
 * `/api/deskcomm/*`) — os agentes "Alunos" e "Interessados" consultam dado
 * real (matrícula/notas/frequência/financeiro, catálogo de cursos) em vez de
 * dependerem só do material anexado no CRM (RAG) ou de um humano.
 *
 * Gated por organização (org_sistema_escolar_config, migration 0169): sem
 * linha configurada, `carregarConfig` devolve `null` e o CHAMADOR decide não
 * oferecer as tools — mesmo padrão de `search_knowledge`
 * (`agentConfig?.activeKbVersionId == null`). Numa instalação de outro
 * nicho (e-commerce, clínica) isso nunca acontece: a tabela fica vazia.
 */
import type pg from "pg";

import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";

export interface ConfigSistemaEscolar {
  baseUrl: string;
  apiKey: string;
}

interface ConfigRow {
  base_url: string;
  api_key_encrypted: Buffer;
  api_key_iv: Buffer;
  api_key_tag: Buffer;
  is_active: boolean;
}

/** `null` = org não tem a integração configurada (ou está desativada) — estado normal, não erro. */
export async function carregarConfig(
  db: pg.Pool,
  organizationId: string,
): Promise<ConfigSistemaEscolar | null> {
  const { rows } = await db.query<ConfigRow>(
    `select base_url, api_key_encrypted, api_key_iv, api_key_tag, is_active
       from org_sistema_escolar_config
      where organization_id = $1`,
    [organizationId],
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;

  const apiKey = decryptKey({
    ciphertext: byteaToBuffer(row.api_key_encrypted),
    iv: byteaToBuffer(row.api_key_iv),
    tag: byteaToBuffer(row.api_key_tag),
  });

  return { baseUrl: row.base_url.replace(/\/$/, ""), apiKey };
}

const TIMEOUT_MS = 8_000;

async function chamar(config: ConfigSistemaEscolar, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { "X-Api-Key": config.apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`sistema escolar respondeu ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface RespostaAlunoPorTelefone {
  encontrado: boolean;
  ambiguo?: boolean;
  alunos: unknown[];
}

/** `telefone` vai cru (dígitos, com ou sem DDI) — a API do sistema escolar normaliza dos dois lados. */
export async function buscarAlunoPorTelefone(
  config: ConfigSistemaEscolar,
  telefone: string,
): Promise<RespostaAlunoPorTelefone> {
  const out = await chamar(config, `/api/deskcomm/aluno?telefone=${encodeURIComponent(telefone)}`);
  return out as RespostaAlunoPorTelefone;
}

export interface RespostaCatalogoCursos {
  cursos: unknown[];
  pacotes: unknown[];
}

export async function buscarCatalogoCursos(config: ConfigSistemaEscolar): Promise<RespostaCatalogoCursos> {
  const out = await chamar(config, "/api/deskcomm/cursos");
  return out as RespostaCatalogoCursos;
}
