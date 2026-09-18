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
import { z } from "zod";

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

export async function chamar(config: ConfigSistemaEscolar, path: string): Promise<unknown> {
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

const horarioSchema = z.object({
  dia_semana: z.string(),
  inicio: z.string(),
  fim: z.string(),
});

const notaSchema = z.object({
  modulo: z.string().nullable(),
  nota: z.union([z.string(), z.number()]).nullable(),
  status: z.string().nullable(),
});

const matriculaSchema = z.object({
  status: z.string(),
  curso_ou_pacote: z.string().nullable(),
  tipo: z.enum(["curso", "pacote"]),
  turma: z.string().nullable(),
  modalidade: z.string().nullable(),
  horarios: z.array(horarioSchema),
  link_aula: z.string().nullable(),
  data_matricula: z.string().nullable(),
  notas: z.array(notaSchema),
  frequencia: z.object({
    total_registros: z.number().int().nonnegative(),
    faltas: z.number().int().nonnegative(),
    presencas: z.number().int().nonnegative(),
  }),
});

const alunoSchema = z.object({
  // O id faz parte do contrato Laravel, mas nunca é devolvido ao modelo: ele
  // não ajuda a responder o aluno e identificador interno não deve vazar.
  id: z.union([z.string(), z.number()]),
  nome: z.string().min(1),
  situacao_financeira: z.string(),
  matriculas: z.array(matriculaSchema),
});

const respostaAlunoPorTelefoneSchema = z.object({
  encontrado: z.boolean(),
  ambiguo: z.boolean().optional(),
  alunos: z.array(alunoSchema),
});

export type AlunoSistemaEscolar = Omit<z.infer<typeof alunoSchema>, "id">;
export type RespostaAlunoPorTelefone = z.infer<typeof respostaAlunoPorTelefoneSchema>;

export type ResultadoSelecaoAluno =
  | { status: "nao_encontrado" }
  | { status: "ambiguo"; quantidade: number }
  | { status: "nome_nao_encontrado" }
  | { status: "encontrado"; aluno: AlunoSistemaEscolar };

function semIdentificadorInterno(
  aluno: RespostaAlunoPorTelefone["alunos"][number],
): AlunoSistemaEscolar {
  const { id: _id, ...dadosPublicos } = aluno;
  return dadosPublicos;
}

function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pt-BR");
}

/**
 * Resolve telefone compartilhado sem entregar ao modelo os dados completos de
 * todos os alunos. Sem nome, só informa a quantidade; com nome, exige igualdade
 * normalizada (acentos/caixa/espaços), nunca aproximação que possa escolher a
 * pessoa errada.
 */
export function selecionarAluno(
  resposta: RespostaAlunoPorTelefone,
  nomeCompleto?: string,
): ResultadoSelecaoAluno {
  if (!resposta.encontrado || resposta.alunos.length === 0) {
    return { status: "nao_encontrado" };
  }

  if (resposta.alunos.length === 1) {
    const unico = resposta.alunos[0];
    if (!unico) return { status: "nao_encontrado" };
    return { status: "encontrado", aluno: semIdentificadorInterno(unico) };
  }

  if (!nomeCompleto?.trim()) {
    return { status: "ambiguo", quantidade: resposta.alunos.length };
  }

  const procurado = normalizarNome(nomeCompleto);
  const candidatos = resposta.alunos.filter((aluno) => normalizarNome(aluno.nome) === procurado);
  if (candidatos.length !== 1) {
    return candidatos.length === 0
      ? { status: "nome_nao_encontrado" }
      : { status: "ambiguo", quantidade: candidatos.length };
  }

  const unico = candidatos[0];
  if (!unico) return { status: "nome_nao_encontrado" };
  return { status: "encontrado", aluno: semIdentificadorInterno(unico) };
}

/** `telefone` vai cru (dígitos, com ou sem DDI) — a API do sistema escolar normaliza dos dois lados. */
export async function buscarAlunoPorTelefone(
  config: ConfigSistemaEscolar,
  telefone: string,
): Promise<RespostaAlunoPorTelefone> {
  const out = await chamar(config, `/api/deskcomm/aluno?telefone=${encodeURIComponent(telefone)}`);
  return respostaAlunoPorTelefoneSchema.parse(out);
}

const respostaCatalogoCursosSchema = z.object({
  cursos: z.array(z.record(z.string(), z.unknown())),
  pacotes: z.array(z.record(z.string(), z.unknown())),
});

export type RespostaCatalogoCursos = z.infer<typeof respostaCatalogoCursosSchema>;

export async function buscarCatalogoCursos(
  config: ConfigSistemaEscolar,
): Promise<RespostaCatalogoCursos> {
  const out = await chamar(config, "/api/deskcomm/cursos");
  return respostaCatalogoCursosSchema.parse(out);
}
