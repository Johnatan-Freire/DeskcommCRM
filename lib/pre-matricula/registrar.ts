/**
 * PRÉ-MATRÍCULA — o registro que o agente comercial faz quando o interessado
 * quer se matricular (migration 0659; auditoria de agentes, 14/10/2026).
 *
 * Decisão da escola: pelo WhatsApp só os dados mínimos — nome completo, e-mail,
 * curso e turno de interesse, telefone. CPF e documentos nunca pelo chat.
 *
 * Disciplina das tools do motor: o payload do modelo é dado NÃO CONFIÁVEL —
 * whitelist `.strict()`, Zod, e organização/contato/conversa/agente vêm do
 * contexto do turno (closure), nunca do payload. O consentimento é exigido em
 * código: `consentimento: true` só depois de a pessoa dizer sim à pergunta, e o
 * texto que ela aceitou vai gravado junto.
 *
 * Depois do registro a continuidade é de uma pessoa: quem chama passa a conversa
 * para a equipe (o aviso ao lead já muda conforme haja consultor no horário).
 */
import { z } from "zod";

/** O texto do consentimento — versionado: mudar a redação é trocar o sufixo. */
export const TEXTO_DO_CONSENTIMENTO_V1 =
  "pre-matricula-v1: a pessoa autorizou a escola a guardar nome, e-mail, telefone, curso e turno " +
  "de interesse para que um consultor dê continuidade à matrícula.";

export const TURNOS = ["manha", "tarde", "noite", "sem_preferencia"] as const;
export type Turno = (typeof TURNOS)[number];

export const registrarPreMatriculaInputSchema = z
  .object({
    nome_completo: z.string().trim().min(3).max(160),
    email: z.string().trim().toLowerCase().email().max(254),
    curso: z.string().trim().min(1).max(160),
    turno: z.enum(TURNOS),
    telefone_contato: z.string().trim().min(8).max(32).optional(),
    consentimento: z.literal(true),
  })
  .strict();

export type RegistrarPreMatriculaInput = z.infer<typeof registrarPreMatriculaInputSchema>;

const ENSINO =
  "Campos: nome_completo (nome e sobrenome), email, curso (o nome do curso do catálogo), turno " +
  "(manha | tarde | noite | sem_preferencia), telefone_contato (só se a pessoa quiser outro número " +
  "além deste WhatsApp) e consentimento: true — SÓ depois de perguntar \"Posso registrar sua " +
  "pré-matrícula com esses dados para um consultor continuar o atendimento?\" e a pessoa dizer sim. " +
  "Não peça CPF, RG, endereço nem documento.";

/** Nome completo = pelo menos duas palavras. */
function temSobrenome(nome: string): boolean {
  return nome.split(/\s+/u).filter((p) => p.length >= 2).length >= 2;
}

/** Só dígitos, com DDI 55 quando vier sem: o mesmo formato que o resto do CRM guarda. */
export function normalizarTelefone(bruto: string): string | null {
  const digitos = bruto.replace(/\D/gu, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}

export type ValidacaoDaPreMatricula =
  | { ok: true; dados: RegistrarPreMatriculaInput & { telefone: string } }
  | { ok: false; erro: { code: string; message: string } };

/** Valida o payload do modelo; `telefoneDaConversa` é o número confiável do contato. */
export function validarPreMatricula(raw: unknown, telefoneDaConversa: string | null): ValidacaoDaPreMatricula {
  if (raw !== null && typeof raw === "object" && Object.getPrototypeOf(raw) !== Object.prototype) {
    return { ok: false, erro: { code: "invalid_payload", message: `payload inválido. ${ENSINO}` } };
  }
  const parsed = registrarPreMatriculaInputSchema.safeParse(raw);
  if (!parsed.success) {
    const semConsentimento = parsed.error.issues.some((i) => i.path[0] === "consentimento");
    return {
      ok: false,
      erro: semConsentimento
        ? {
            code: "sem_consentimento",
            message:
              "a pré-matrícula só pode ser registrada depois de a pessoa autorizar. Pergunte e, com o sim, " +
              "chame de novo com consentimento: true.",
          }
        : { code: "invalid_payload", message: `dados inválidos. ${ENSINO}` },
    };
  }
  if (!temSobrenome(parsed.data.nome_completo)) {
    return { ok: false, erro: { code: "nome_incompleto", message: "peça o nome completo (nome e sobrenome)." } };
  }
  const bruto = parsed.data.telefone_contato ?? telefoneDaConversa;
  const telefone = bruto ? normalizarTelefone(bruto) : null;
  if (telefone === null) {
    return {
      ok: false,
      erro: { code: "telefone_invalido", message: "peça um telefone com DDD para o consultor entrar em contato." },
    };
  }
  return { ok: true, dados: { ...parsed.data, telefone } };
}

export interface ContextoDaPreMatricula {
  organizationId: string;
  contactId: string;
  conversationId: string | null;
  agentId: string | null;
}

export type ResultadoDoRegistro =
  | { ok: true; status: "registrada" | "ja_existia"; id: string }
  | { ok: false; erro: { code: string; message: string } };

interface Queryable {
  query<R>(sql: string, params: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Grava a pré-matrícula. Idempotente pelo índice único parcial (uma aberta por
 * contato e curso): a segunda confirmação devolve a que já existe.
 */
export async function registrarPreMatricula(
  db: Queryable,
  ctx: ContextoDaPreMatricula,
  dados: RegistrarPreMatriculaInput & { telefone: string },
): Promise<ResultadoDoRegistro> {
  const { rows } = await db.query<{ id: string; inserida: boolean }>(
    `with lead as (
       select id from crm_leads
        where organization_id = $1 and contact_id = $2 and status = 'open'
        order by updated_at desc nulls last limit 1
     ), novo as (
       insert into pre_matriculas
         (organization_id, contact_id, conversation_id, lead_id, agent_id,
          nome_completo, email, telefone, curso, turno, consentimento_em, consentimento_texto)
       select $1, $2, $3, (select id from lead), $4, $5, $6, $7, $8, $9, now(), $10
       on conflict (organization_id, contact_id, lower(btrim(curso))) where status in ('nova', 'em_atendimento')
       do nothing
       returning id
     )
     select id, true as inserida from novo
     union all
     select id, false from pre_matriculas
      where organization_id = $1 and contact_id = $2 and lower(btrim(curso)) = lower(btrim($8))
        and status in ('nova', 'em_atendimento')
        and not exists (select 1 from novo)
     limit 1`,
    [
      ctx.organizationId,
      ctx.contactId,
      ctx.conversationId,
      ctx.agentId,
      dados.nome_completo,
      dados.email,
      dados.telefone,
      dados.curso,
      dados.turno,
      TEXTO_DO_CONSENTIMENTO_V1,
    ],
  );
  const linha = rows[0];
  if (linha) return { ok: true, status: linha.inserida ? "registrada" : "ja_existia", id: linha.id };

  // CORRIDA: duas confirmações simultâneas do mesmo curso. A segunda espera a
  // primeira gravar e o ON CONFLICT não insere nada — mas o SELECT do mesmo
  // comando enxerga o banco como estava quando o comando COMEÇOU, sem a linha da
  // primeira. Um comando novo (snapshot novo) a encontra.
  const { rows: existentes } = await db.query<{ id: string }>(
    `select id from pre_matriculas
      where organization_id = $1 and contact_id = $2 and lower(btrim(curso)) = lower(btrim($3))
        and status in ('nova', 'em_atendimento')
      limit 1`,
    [ctx.organizationId, ctx.contactId, dados.curso],
  );
  const existente = existentes[0];
  if (existente) return { ok: true, status: "ja_existia", id: existente.id };
  return { ok: false, erro: { code: "nao_registrada", message: "não consegui registrar agora." } };
}

/** O que a tool devolve ao modelo depois de registrar (e passar para a equipe). */
export function mensagemAposRegistro(status: "registrada" | "ja_existia"): string {
  const base =
    status === "registrada"
      ? "pré-matrícula registrada e a conversa foi passada para um consultor."
      : "já havia uma pré-matrícula aberta para este curso; a conversa foi passada para um consultor.";
  return (
    `${base} Diga em uma frase que um consultor vai continuar o atendimento. NÃO diga que a ` +
    "matrícula está feita, que a vaga está garantida nem que o pagamento foi confirmado — só a equipe " +
    "confirma isso. Encerre o turno."
  );
}

/** Status que a EQUIPE escolhe na fila (a IA só cria em `nova`). */
export const STATUS_DA_PRE_MATRICULA = ["nova", "em_atendimento", "matriculado", "desistiu"] as const;
export type StatusDaPreMatricula = (typeof STATUS_DA_PRE_MATRICULA)[number];

export const alterarPreMatriculaSchema = z
  .object({
    status: z.enum(STATUS_DA_PRE_MATRICULA).optional(),
    observacao: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((a) => a.status !== undefined || a.observacao !== undefined, { message: "Nada para alterar." });

export const COLUNAS_DA_PRE_MATRICULA =
  "id, contact_id, conversation_id, lead_id, nome_completo, email, telefone, curso, turno, status, origem, atendida_por, observacao, consentimento_em, created_at, updated_at";
