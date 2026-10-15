/**
 * AVISOS TEMPORÁRIOS — informação com prazo que os agentes de IA usam como
 * contexto (migration 0658; auditoria de agentes, 14/10/2026).
 *
 * A régua do prazo é do banco (`fn_avisos_vigentes`): o turno só recebe aviso
 * publicado e dentro de [início, fim). Este módulo tem o contrato de entrada da
 * tela/API (Zod), o mapa escopo do agente → público, e a renderização do bloco
 * que entra no prompt — pura e testável.
 *
 * O bloco diz ao modelo, com todas as letras, que o aviso VALE ATÉ uma data e que
 * nada além do texto pode ser prometido: promoção que não está aqui não existe.
 */
import type pg from "pg";
import { z } from "zod";

/** As colunas que a tela e a API leem (sem nada que não seja do aviso). */
export const COLUNAS_DO_AVISO =
  "id, titulo, descricao, inicio_em, fim_em, status, publico, agente_ids, cursos, prioridade, created_by, updated_by, created_at, updated_at";

export const STATUS_DO_AVISO = ["rascunho", "publicado", "arquivado"] as const;
export const PUBLICOS_DO_AVISO = ["leads", "alunos", "todos"] as const;
export type PublicoDoAviso = (typeof PUBLICOS_DO_AVISO)[number];

const dataHora = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s).toISOString());

const camposDoAviso = {
  titulo: z.string().trim().min(1).max(120),
  descricao: z.string().trim().min(1).max(2000),
  inicio_em: dataHora,
  fim_em: dataHora,
  status: z.enum(STATUS_DO_AVISO),
  publico: z.enum(PUBLICOS_DO_AVISO),
  agente_ids: z.array(z.string().uuid()).max(20),
  cursos: z.array(z.string().trim().min(1).max(120)).max(20),
  prioridade: z.number().int().min(0).max(100),
};

export const criarAvisoSchema = z
  .object({
    ...camposDoAviso,
    status: camposDoAviso.status.default("rascunho"),
    publico: camposDoAviso.publico.default("todos"),
    agente_ids: camposDoAviso.agente_ids.default([]),
    cursos: camposDoAviso.cursos.default([]),
    prioridade: camposDoAviso.prioridade.default(0),
  })
  .strict()
  .refine((a) => new Date(a.fim_em) > new Date(a.inicio_em), {
    message: "O fim precisa ser depois do início.",
    path: ["fim_em"],
  });

export const editarAvisoSchema = z
  .object({
    titulo: camposDoAviso.titulo.optional(),
    descricao: camposDoAviso.descricao.optional(),
    inicio_em: camposDoAviso.inicio_em.optional(),
    fim_em: camposDoAviso.fim_em.optional(),
    status: camposDoAviso.status.optional(),
    publico: camposDoAviso.publico.optional(),
    agente_ids: camposDoAviso.agente_ids.optional(),
    cursos: camposDoAviso.cursos.optional(),
    prioridade: camposDoAviso.prioridade.optional(),
  })
  .strict()
  .refine((a) => Object.keys(a).length > 0, { message: "Nada para alterar." });

export type CriarAviso = z.infer<typeof criarAvisoSchema>;
export type EditarAviso = z.infer<typeof editarAvisoSchema>;

/** Escopo do agente → quem ele atende. Sem escopo conhecido = atende leads (comercial). */
export function publicoDoEscopo(escopo: string | null | undefined): Exclude<PublicoDoAviso, "todos"> {
  return escopo === "academico" ? "alunos" : "leads";
}

export interface AvisoVigente {
  titulo: string;
  descricao: string;
  fim_em: string | Date;
  cursos: string[];
}

/**
 * `DD/MM/AAAA, HH:MM` no fuso da organização, montado pelas PARTES da data — o
 * bloco é instrução para o modelo, e o formato não pode depender do idioma do
 * processo (nem fixar um idioma de tela, que é a camada de i18n).
 */
function dataNoFuso(instante: string | Date, fuso: string): string {
  try {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instante));
    const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
    return `${p("day")}/${p("month")}/${p("year")}, ${p("hour")}:${p("minute")}`;
  } catch {
    return new Date(instante).toISOString();
  }
}

/**
 * O bloco do prompt. Vazio quando não há aviso vigente — e aí o modelo recebe a
 * regra assim mesmo: sem aviso, não há promoção nem condição especial a oferecer.
 */
export function renderAvisosVigentes(avisos: readonly AvisoVigente[], fuso: string): string {
  const cabecalho =
    "=== avisos temporários vigentes (informação com prazo, cadastrada pela equipe) ===\n" +
    "Use um aviso só enquanto ele estiver nesta lista e apenas com o que está escrito nele. " +
    "Promoção, desconto, data de turma ou condição especial que NÃO estiver aqui nem no " +
    "catálogo não existe: não ofereça, não invente e não estenda prazo. " +
    "Se um aviso daqui contradisser o catálogo ou os materiais (um preço promocional, um " +
    "horário diferente), vale o aviso, só no que ele disser e só até a data dele; no resto, e " +
    "depois do fim, vale o catálogo. Se dois avisos se contradisserem, vale o primeiro da lista " +
    "(o de maior prioridade) e, na dúvida, confirme com a equipe.";
  if (avisos.length === 0) {
    return `${cabecalho}\n(nenhum aviso vigente agora)`;
  }
  const linhas = avisos.map((a) => {
    const cursos = a.cursos.length > 0 ? ` Cursos: ${a.cursos.join(", ")}.` : "";
    return `- ${a.titulo} (válido até ${dataNoFuso(a.fim_em, fuso)}): ${a.descricao}${cursos}`;
  });
  return `${cabecalho}\n${linhas.join("\n")}`;
}

/** Quando a leitura falha: o turno segue, mas sem nenhuma condição temporária a oferecer. */
export const AVISOS_INDISPONIVEIS =
  "=== avisos temporários vigentes ===\n" +
  "Não foi possível ler os avisos agora. Não ofereça promoção, desconto, data de turma nem " +
  "condição especial que não esteja no catálogo; se perguntarem, diga que vai confirmar com a equipe.";

/** Leitura do turno (motor, `pg`): a função do banco decide o que está vigente. */
export async function carregarAvisosVigentes(
  db: Pick<pg.Pool, "query">,
  input: { organizationId: string; escopoDoAgente: string | null | undefined; agentId: string | null },
): Promise<AvisoVigente[]> {
  const { rows } = await db.query<{ titulo: string; descricao: string; fim_em: Date; cursos: string[] }>(
    "select titulo, descricao, fim_em, cursos from public.fn_avisos_vigentes($1, $2, $3)",
    [input.organizationId, publicoDoEscopo(input.escopoDoAgente), input.agentId],
  );
  return rows;
}
