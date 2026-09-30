/**
 * RESOLVEDOR DE IDENTIDADE — roda ANTES da escolha do agente.
 *
 *   mensagem → [identidade] → política da etapa → escolha do agente → turno
 *
 * Um contato recém-chegado nasce em "Novo" (comercial). Se o telefone dele está no
 * cadastro escolar com casamento exato, o card vai para a etapa acadêmica ANTES de
 * o agente ser escolhido — e aí só o agente acadêmico pode atendê-lo
 * (`fn_ia_pode_responder_mensagem`). A decisão de identidade mora em
 * `lib/leads/identidade-escolar.ts`; este arquivo decide QUANDO perguntar.
 *
 * ## Quando NÃO pergunta (e por que isso é custo zero para quem não usa)
 *
 *   - a etapa atual do contato não é comercial: quem já está na acadêmica não
 *     volta a ser consultado (e não poderia sair: `exit_locked`); terminal e
 *     só-humano não são reclassificados por telefone;
 *   - o funil do lead aberto não tem etapa acadêmica: instalação que não usa a
 *     regra nunca faz a chamada;
 *   - a organização não tem a integração ativa, ou o contato não tem telefone.
 *
 * ## Cache
 *
 * Só do "desconhecido", em memória do processo, por 10 minutos: uma rajada de
 * mensagens do mesmo número não vira uma rajada de chamadas ao Sistema Escolar.
 * O positivo não precisa de cache — ele MOVE o card, e a etapa acadêmica já não é
 * comercial. Nenhum dado de aluno é guardado aqui, nem id interno.
 *
 * ## Falha
 *
 * Qualquer erro (integração fora, timeout, payload inválido, banco) = seguir como
 * desconhecido, sem cache (a próxima mensagem tenta de novo). O turno nunca cai
 * por causa deste passo.
 */
import type pg from 'pg';

import {
  buscarAlunoPorTelefone,
  carregarConfig,
  type ConfigSistemaEscolar,
  type RespostaAlunoPorTelefone,
} from '@/lib/integracoes/sistema-escolar';
import {
  decidirIdentidadeEscolar,
  moverContatoParaEtapaAcademica,
  type IdentidadeEscolar,
  type ResultadoDaEtapaAcademica,
} from '@/lib/leads/identidade-escolar';
import { createAdminClient } from '@/lib/supabase/admin';

import type { Logger } from '../obs/logger';

export const CACHE_DO_DESCONHECIDO_MS = 10 * 60_000;
const cacheDoDesconhecido = new Map<string, number>();

/** Só para teste: o cache é de processo e atravessaria casos. */
export function limparCacheDeIdentidade(): void {
  cacheDoDesconhecido.clear();
}

export type DesfechoDaIdentidade =
  | { consultou: false; motivo: 'etapa_nao_comercial' | 'sem_etapa_academica' | 'sem_integracao' | 'sem_telefone' | 'cache_desconhecido' }
  | { consultou: true; identidade: IdentidadeEscolar; falhou: boolean; movimento?: ResultadoDaEtapaAcademica };

export interface IdentidadeDeps {
  politica?: (db: pg.Pool, tenantId: string, contactId: string) => Promise<string>;
  temEtapaAcademica?: (db: pg.Pool, tenantId: string, contactId: string) => Promise<boolean>;
  telefone?: (db: pg.Pool, tenantId: string, contactId: string) => Promise<string | null>;
  carregarConfig?: (db: pg.Pool, tenantId: string) => Promise<ConfigSistemaEscolar | null>;
  buscar?: (config: ConfigSistemaEscolar, telefone: string) => Promise<RespostaAlunoPorTelefone>;
  mover?: (input: { organizationId: string; contactId: string }) => Promise<ResultadoDaEtapaAcademica>;
  agora?: () => number;
}

async function politicaPadrao(db: pg.Pool, tenantId: string, contactId: string): Promise<string> {
  const { rows } = await db.query<{ p: string | null }>(
    'select public.fn_politica_de_atendimento_do_contato($1,$2) as p',
    [tenantId, contactId],
  );
  return rows[0]?.p ?? 'comercial';
}

async function temEtapaAcademicaPadrao(db: pg.Pool, tenantId: string, contactId: string): Promise<boolean> {
  const { rows } = await db.query<{ tem: boolean }>(
    `select exists (
       select 1 from crm_leads l
         join crm_stages s on s.pipeline_id = l.pipeline_id and s.organization_id = l.organization_id
        where l.organization_id = $1 and l.contact_id = $2 and l.status = 'open'
          and s.service_policy = 'academico' and not s.is_archived) as tem`,
    [tenantId, contactId],
  );
  return rows[0]?.tem === true;
}

async function telefonePadrao(db: pg.Pool, tenantId: string, contactId: string): Promise<string | null> {
  const { rows } = await db.query<{ phone_number: string | null }>(
    'select phone_number from contacts where organization_id = $1 and id = $2',
    [tenantId, contactId],
  );
  const tel = rows[0]?.phone_number?.trim();
  return tel ? tel : null;
}

export async function resolverIdentidadeDoContato(
  db: pg.Pool,
  input: { tenantId: string; contactId: string },
  log: Logger,
  deps: IdentidadeDeps = {},
): Promise<DesfechoDaIdentidade> {
  const agora = (deps.agora ?? Date.now)();
  const chave = `${input.tenantId}:${input.contactId}`;
  try {
    if ((await (deps.politica ?? politicaPadrao)(db, input.tenantId, input.contactId)) !== 'comercial') {
      return { consultou: false, motivo: 'etapa_nao_comercial' };
    }
    if (!(await (deps.temEtapaAcademica ?? temEtapaAcademicaPadrao)(db, input.tenantId, input.contactId))) {
      return { consultou: false, motivo: 'sem_etapa_academica' };
    }
    const expira = cacheDoDesconhecido.get(chave);
    if (expira !== undefined && expira > agora) return { consultou: false, motivo: 'cache_desconhecido' };

    const config = await (deps.carregarConfig ?? carregarConfig)(db, input.tenantId);
    if (config === null) return { consultou: false, motivo: 'sem_integracao' };
    const telefone = await (deps.telefone ?? telefonePadrao)(db, input.tenantId, input.contactId);
    if (telefone === null) return { consultou: false, motivo: 'sem_telefone' };

    let resposta: RespostaAlunoPorTelefone | null = null;
    let falhou = false;
    try {
      resposta = await (deps.buscar ?? buscarAlunoPorTelefone)(config, telefone);
    } catch (err) {
      falhou = true;
      log.warn('identidade escolar: consulta falhou — contato segue desconhecido', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const identidade = decidirIdentidadeEscolar(resposta);
    if (identidade === 'desconhecido') {
      // Falha não entra no cache: a próxima mensagem tenta de novo.
      if (!falhou) cacheDoDesconhecido.set(chave, agora + CACHE_DO_DESCONHECIDO_MS);
      return { consultou: true, identidade, falhou };
    }

    const movimento = await (
      deps.mover ??
      ((i: { organizationId: string; contactId: string }) => moverContatoParaEtapaAcademica(createAdminClient(), i))
    )({ organizationId: input.tenantId, contactId: input.contactId });
    log.info('identidade escolar: telefone relacionado a aluno', { motivo_do_movimento: movimento.motivo });
    return { consultou: true, identidade, falhou: false, movimento };
  } catch (err) {
    log.warn('identidade escolar: erro inesperado — contato segue como estava', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { consultou: true, identidade: 'desconhecido', falhou: true };
  }
}
