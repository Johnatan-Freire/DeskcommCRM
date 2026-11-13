/**
 * MATERIAIS DO AGENTE — vídeos, imagens e PDFs que a equipe cadastra para os
 * agentes de IA enviarem na conversa (migration 8006).
 *
 * A equipe sobe o arquivo e escreve, em texto livre, EM QUE SITUAÇÃO ele deve
 * ser enviado ("quando o lead demonstrar interesse em Informática Básica e ainda
 * não tiver visto o curso"). O agente recebe a lista dos materiais que lhe cabem
 * num bloco do contexto — como os avisos temporários — e decide pelo contexto da
 * conversa. O envio é `send_message` com `material_id`
 * (`lib/agent-engine/agent/material-do-agente.ts`).
 *
 * Este módulo é a fonte única de: tipos aceitos e teto de tamanho (iguais ao
 * bucket `agent-materials`), detecção do formato pelos BYTES, validação da tela e
 * da API (Zod), leitura dos materiais de um agente e o texto do bloco.
 */
import { z } from "zod";

export const BUCKET_DOS_MATERIAIS = "agent-materials";

/** 16 MB: o teto de vídeo do WhatsApp, e o `file_size_limit` do bucket. */
export const TAMANHO_MAXIMO_DO_MATERIAL = 16 * 1024 * 1024;

export const TIPOS_DE_MATERIAL = ["video", "imagem", "documento"] as const;
export type TipoDeMaterial = (typeof TIPOS_DE_MATERIAL)[number];

export const COLUNAS_DO_MATERIAL =
  "id, titulo, quando_enviar, tipo, mime, tamanho_bytes, agente_ids, ativo, created_at, updated_at";

export interface FormatoDoMaterial {
  tipo: TipoDeMaterial;
  mime: "video/mp4" | "image/jpeg" | "image/png" | "application/pdf";
  ext: "mp4" | "jpg" | "png" | "pdf";
}

/**
 * O formato decidido pelos BYTES do arquivo, nunca pelo nome nem pelo MIME que o
 * navegador declarou (os dois mentem com facilidade). `null` = formato que o
 * canal não envia como vídeo, imagem ou documento.
 *
 *   MP4  → caixa `ftyp` nos bytes 4..7
 *   JPEG → FF D8 FF
 *   PNG  → 89 50 4E 47 0D 0A 1A 0A
 *   PDF  → %PDF-
 */
export function farejarFormato(bytes: Uint8Array): FormatoDoMaterial | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 12 && b(4) === 0x66 && b(5) === 0x74 && b(6) === 0x79 && b(7) === 0x70) {
    return { tipo: "video", mime: "video/mp4", ext: "mp4" };
  }
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return { tipo: "imagem", mime: "image/jpeg", ext: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((v, i) => b(i) === v)) {
    return { tipo: "imagem", mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 5 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) {
    return { tipo: "documento", mime: "application/pdf", ext: "pdf" };
  }
  return null;
}

/** O tipo de mensagem do canal para o MIME guardado. */
export function tipoDeMensagemDoMime(mime: string): "video" | "image" | "document" {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "document";
}

const texto = (min: number, max: number) =>
  z.string().transform((s) => s.trim()).pipe(z.string().min(min).max(max));

const camposDoMaterial = {
  titulo: texto(1, 120),
  quando_enviar: texto(10, 2000),
  agente_ids: z.array(z.string().uuid()).max(50),
  ativo: z.boolean(),
};

/** O que acompanha o arquivo no cadastro (campos do formulário). */
export const criarMaterialSchema = z
  .object({
    titulo: camposDoMaterial.titulo,
    quando_enviar: camposDoMaterial.quando_enviar,
    agente_ids: camposDoMaterial.agente_ids.default([]),
    ativo: camposDoMaterial.ativo.default(true),
  })
  .strict();

/** Edição: o arquivo não muda (trocar arquivo = novo material). */
export const editarMaterialSchema = z
  .object({
    titulo: camposDoMaterial.titulo.optional(),
    quando_enviar: camposDoMaterial.quando_enviar.optional(),
    agente_ids: camposDoMaterial.agente_ids.optional(),
    ativo: camposDoMaterial.ativo.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nada para alterar" });

export type CriarMaterial = z.infer<typeof criarMaterialSchema>;
export type EditarMaterial = z.infer<typeof editarMaterialSchema>;

/** O caminho do arquivo no bucket — o CHECK da tabela exige exatamente este. */
export function caminhoDoMaterial(organizationId: string, materialId: string, ext: string): string {
  return `${organizationId}/${materialId}.${ext}`;
}

/** Um material que o agente pode enviar neste turno. */
export interface MaterialDisponivel {
  id: string;
  titulo: string;
  quando_enviar: string;
  tipo: TipoDeMaterial;
}

interface Consulta {
  query<R extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<{ rows: R[] }>;
}

/** Teto de materiais no bloco: o contexto não cresce sem limite. */
export const MAXIMO_DE_MATERIAIS_NO_CONTEXTO = 30;

/**
 * Os materiais ATIVOS que este agente pode enviar: os de `agente_ids` vazio
 * (todos os agentes) e os que o nomeiam.
 */
export async function carregarMateriaisDoAgente(
  db: Consulta,
  input: { organizationId: string; agentId: string | null },
): Promise<MaterialDisponivel[]> {
  const { rows } = await db.query<{ id: string; titulo: string; quando_enviar: string; tipo: TipoDeMaterial }>(
    `select id, titulo, quando_enviar, tipo
       from materiais_do_agente
      where organization_id = $1 and ativo
        and (cardinality(agente_ids) = 0 or $2::uuid = any(agente_ids))
      order by created_at, id
      limit $3`,
    [input.organizationId, input.agentId, MAXIMO_DE_MATERIAIS_NO_CONTEXTO],
  );
  return rows;
}

const ROTULO_DO_TIPO: Record<TipoDeMaterial, string> = {
  video: "vídeo",
  imagem: "imagem",
  documento: "PDF",
};

/** Texto livre da equipe num bloco de linha única: sem quebra que imite instrução. */
const umaLinha = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * O bloco do contexto. Vazio quando não há material: nada de ensinar o modelo a
 * usar o que não existe.
 */
export function renderMateriaisDoAgente(materiais: readonly MaterialDisponivel[]): string {
  if (materiais.length === 0) return "";
  const linhas = materiais.map(
    (m) =>
      `- material_id ${m.id} · ${ROTULO_DO_TIPO[m.tipo]} · "${umaLinha(m.titulo)}" — enviar quando: ${umaLinha(m.quando_enviar)}`,
  );
  return [
    "MATERIAIS PARA ENVIAR (cadastrados pela equipe):",
    ...linhas,
    "Para enviar um material, chame send_message com o `material_id` dele; o texto da mensagem vai como legenda. " +
      "Envie só quando a situação descrita acontecer de fato na conversa, nunca por enviar, e no máximo um material por mensagem. " +
      "Se o cliente pediu informação, responda a pergunta dele também. " +
      "O mesmo material não é enviado duas vezes na mesma conversa: se o sistema recusar, siga só com texto.",
  ].join("\n");
}

/** Leitura falhou: o turno segue sem materiais, e o modelo não promete envio. */
export const MATERIAIS_INDISPONIVEIS =
  "MATERIAIS PARA ENVIAR: a lista não pôde ser carregada agora. Não prometa enviar vídeo, imagem ou PDF neste turno.";
