/**
 * Integração com o sistema escolar (Laravel externo da Capital Code,
 * `/api/deskcomm/*`) — os agentes "Alunos" e "Interessados" consultam dado
 * real (matrícula/notas/frequência/financeiro, catálogo de cursos) em vez de
 * dependerem só do material anexado no CRM (RAG) ou de um humano.
 *
 * Gated por organização (org_sistema_escolar_config, migration 0399): sem
 * linha configurada, `carregarConfig` devolve `null` e o CHAMADOR decide não
 * oferecer as tools — mesmo padrão de `search_knowledge`
 * (`agentConfig?.activeKbVersionId == null`). Numa instalação de outro
 * nicho (e-commerce, clínica) isso nunca acontece: a tabela fica vazia.
 */
import type pg from "pg";
import { z } from "zod";

import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { logger } from "@/lib/logger";

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
    .replace(/[̀-ͯ]/gu, "")
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

/**
 * Campos confirmados contra o payload REAL de produção (GET /api/deskcomm/cursos,
 * 15 cursos + 10 pacotes medidos), não inferidos. Duas divergências reais do
 * lado Laravel, preservadas de propósito em vez de "corrigidas" aqui:
 *
 *  - `carga_horaria` é STRING em curso ("44.0") e NUMBER|null em pacote (189)
 *    — normalizar esconderia uma divergência real do backend.
 *  - Valores monetários (`valor_integral`/`valor_avista`/`valor_parcela`) são
 *    strings decimais ("780.00"), nunca number — evita arredondamento de
 *    float em dinheiro; formatação fica por conta de quem consome.
 *
 * Campo obrigatório faltando ou tipo incorreto vira `ZodError` no `.parse()` —
 * capturado pelo mesmo catch genérico que já existe no `execute()` da tool em
 * `inbound-turn.ts` (falha_consulta), sem plumbing novo.
 */
const catalogoCursoSchema = z.object({
  tipo: z.literal("curso"),
  nome: z.string(),
  descricao: z.string(),
  area: z.string().nullable(),
  modalidade: z.array(z.string()),
  turnos: z.array(z.string()),
  carga_horaria: z.string(),
  duracao_meses: z.number().int().nullable(),
  publico_alvo: z.string().nullable(),
  saidas_profissionais: z.string().nullable(),
  valor_integral: z.string(),
  valor_avista: z.string().nullable(),
  parcelas: z.number().int().nullable(),
  valor_parcela: z.string().nullable(),
  em_destaque: z.boolean(),
});

const catalogoPacoteSchema = z.object({
  tipo: z.literal("pacote"),
  nome: z.string(),
  descricao: z.string(),
  area: z.string().nullable(),
  cursos_inclusos: z.array(z.string()),
  carga_horaria: z.number().nullable(),
  duracao_meses: z.number().int().nullable(),
  publico_alvo: z.string().nullable(),
  objetivo_profissional: z.string().nullable(),
  habilidades: z.string().nullable(),
  valor_integral: z.string(),
  valor_avista: z.string().nullable(),
  parcelas: z.number().int().nullable(),
  valor_parcela: z.string().nullable(),
  economia_total: z.string().nullable(),
});

const respostaCatalogoCursosSchema = z.object({
  cursos: z.array(catalogoCursoSchema),
  pacotes: z.array(catalogoPacoteSchema),
});

export type CatalogoCurso = z.infer<typeof catalogoCursoSchema>;
export type CatalogoPacote = z.infer<typeof catalogoPacoteSchema>;
export type RespostaCatalogoCursos = z.infer<typeof respostaCatalogoCursosSchema>;

export async function buscarCatalogoCursos(
  config: ConfigSistemaEscolar,
): Promise<RespostaCatalogoCursos> {
  const out = await chamar(config, "/api/deskcomm/cursos");
  return respostaCatalogoCursosSchema.parse(out);
}

/**
 * Regra comercial vigente (confirmada com o responsável da Capital Code E
 * contra o catálogo real de produção): só presencial e EAD. `híbrido`/`hibrido`
 * existe como valor TÉCNICO possível do lado Laravel (CursoRequest aceita
 * "híbrido", seeders gravam "hibrido" sem acento — bug de acento documentado
 * em separado) mas NÃO é modalidade comercial atual — não deve ser apresentado
 * ao lead como se fosse. Por isso não entra no array canônico: é tratado como
 * qualquer valor desconhecido para fins de exibição, só o log interno distingue
 * "híbrido/legado" de "realmente desconhecido" para diagnóstico.
 */
const MODALIDADES_COMERCIAIS = new Set(["presencial", "ead"]);
const MODALIDADES_LEGADO_NAO_COMERCIAL = new Set(["hibrido", "híbrido"]);

function normalizarChaveModalidade(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface ModalidadeSanitizada {
  modalidade: string[];
  modalidade_status: "ok" | "inconsistente";
}

/**
 * `raw=[]` (curso sem modalidade cadastrada) também é "inconsistente" —
 * ausência de dado nunca deve ler como "modalidade indefinida = tudo bem".
 */
export function sanitizarModalidades(raw: string[], contexto: { curso: string }): ModalidadeSanitizada {
  const canonicas: string[] = [];
  const naoComerciais: string[] = [];
  for (const valor of raw) {
    const chave = normalizarChaveModalidade(valor);
    if (MODALIDADES_COMERCIAIS.has(chave)) {
      if (!canonicas.includes(chave)) canonicas.push(chave);
    } else {
      naoComerciais.push(valor);
    }
  }
  if (naoComerciais.length > 0) {
    const legado = naoComerciais.filter((v) => MODALIDADES_LEGADO_NAO_COMERCIAL.has(normalizarChaveModalidade(v)));
    const desconhecidos = naoComerciais.filter((v) => !MODALIDADES_LEGADO_NAO_COMERCIAL.has(normalizarChaveModalidade(v)));
    if (legado.length > 0) {
      logger.warn("[sistema-escolar] modalidade híbrida/legada — não é modalidade comercial atual da Capital Code", {
        curso: contexto.curso,
        valores: legado,
      });
    }
    if (desconhecidos.length > 0) {
      logger.warn("[sistema-escolar] modalidade desconhecida no catálogo", {
        curso: contexto.curso,
        valores: desconhecidos,
      });
    }
  }
  return {
    modalidade: canonicas,
    modalidade_status: raw.length > 0 && naoComerciais.length === 0 ? "ok" : "inconsistente",
  };
}

export type CursoComModalidadeSanitizada = Omit<CatalogoCurso, "modalidade"> & ModalidadeSanitizada;

/** Aplica a sanitização de modalidade a todo o catálogo — pacotes não têm o campo. */
export function sanitizarCatalogo(catalogo: RespostaCatalogoCursos): {
  cursos: CursoComModalidadeSanitizada[];
  pacotes: CatalogoPacote[];
} {
  return {
    cursos: catalogo.cursos.map((c) => {
      const { modalidade, ...resto } = c;
      return { ...resto, ...sanitizarModalidades(modalidade, { curso: c.nome }) };
    }),
    pacotes: catalogo.pacotes,
  };
}

function normalizarTextoBusca(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, " ");
}

export interface CatalogoFiltrado {
  cursos: CursoComModalidadeSanitizada[];
  pacotes: CatalogoPacote[];
  match_count: number;
  ambiguous: boolean;
}

/**
 * Busca textual determinística — 4 níveis, em ordem de precedência, PARA no
 * primeiro nível com ≥1 resultado (nunca mistura níveis). Sem distância de
 * edição/fuzzy: só substring e token, sempre explicável. `query` ausente ou
 * vazia devolve tudo (comportamento anterior preservado).
 */
export function filtrarCatalogo(
  catalogo: { cursos: CursoComModalidadeSanitizada[]; pacotes: CatalogoPacote[] },
  opts: { query?: string; tipo?: "curso" | "pacote" | "todos" },
): CatalogoFiltrado {
  const tipo = opts.tipo ?? "todos";
  const cursosBase = tipo === "pacote" ? [] : catalogo.cursos;
  const pacotesBase = tipo === "curso" ? [] : catalogo.pacotes;

  if (!opts.query?.trim()) {
    return {
      cursos: cursosBase,
      pacotes: pacotesBase,
      match_count: cursosBase.length + pacotesBase.length,
      ambiguous: false,
    };
  }

  const q = normalizarTextoBusca(opts.query);
  type Item =
    | { tipo: "curso"; item: CursoComModalidadeSanitizada }
    | { tipo: "pacote"; item: CatalogoPacote };
  const todos: Item[] = [
    ...cursosBase.map((item): Item => ({ tipo: "curso", item })),
    ...pacotesBase.map((item): Item => ({ tipo: "pacote", item })),
  ];

  const niveis: Array<(nome: string) => boolean> = [
    (nome) => normalizarTextoBusca(nome) === q,
    (nome) => normalizarTextoBusca(nome).includes(q),
    (nome) => q.includes(normalizarTextoBusca(nome)),
    (nome) => {
      const tokens = q.split(" ").filter(Boolean);
      const nomeNorm = normalizarTextoBusca(nome);
      return tokens.length > 0 && tokens.every((t) => nomeNorm.includes(t));
    },
  ];

  for (const testar of niveis) {
    const achados = todos.filter((x) => testar(x.item.nome));
    if (achados.length > 0) {
      const cursos = achados
        .filter((x): x is Extract<Item, { tipo: "curso" }> => x.tipo === "curso")
        .map((x) => x.item);
      const pacotes = achados
        .filter((x): x is Extract<Item, { tipo: "pacote" }> => x.tipo === "pacote")
        .map((x) => x.item);
      return { cursos, pacotes, match_count: achados.length, ambiguous: achados.length > 1 };
    }
  }
  return { cursos: [], pacotes: [], match_count: 0, ambiguous: false };
}
