/**
 * PASSAR A CONVERSA DE UM AGENTE DE IA PARA OUTRO DO MESMO NÚMERO.
 *
 * Adaptação, à régua de etapa deste fork, da ação do upstream (#3823/#3770).
 *
 * ─── Por que não é a versão do upstream ────────────────────────────────────
 *
 * No upstream a passagem é o "sticky" de um ROTEADOR: só vale em número com
 * roteador ativo e recusa (`sem_roteador`) em todo o resto. Aqui quem escolhe o
 * agente é a ETAPA do contato (migration 0404, `aplicaEscopoDaEtapa` em
 * `resolve-turn-agent.ts`): contato em etapa acadêmica vai ao agente acadêmico,
 * sempre. Foi isso que deixou o agente de Alunos sem saída quando um aluno
 * pergunta de outro curso: não havia como entregá-lo ao Comercial.
 *
 * A passagem fica gravada NA CONVERSA (`agente_passado_id`/`agente_passado_em`,
 * migration 8004) e vence a etapa até o atendimento ser encerrado. Duas pontas
 * a respeitam, e as duas leem a mesma regra SQL (`fn_agente_passado_da_conversa`):
 *
 *  - o resolvedor do turno (`aplicaEscopoDaEtapa`), que escolhe o agente;
 *  - `fn_ia_pode_responder_mensagem`, que autoriza a resposta (drain e turno) e
 *    passa a exigir o escopo do agente que recebeu a conversa.
 *
 * Etapa só-humana ou terminal continua vencendo a passagem: ela troca de
 * agente, nunca devolve à IA um contato que a equipe tirou dela.
 *
 * ─── A trilha ──────────────────────────────────────────────────────────────
 *
 * Cada passagem grava uma linha em `ai_router_decisions` (sem roteador:
 * `router_id` nulo), com desfecho `transferred`, `origem = 'acao'`, o agente de
 * origem, o de destino, quem pediu e por quê. Sem texto livre: a tabela é lida
 * por toda a organização e tem contrato de "sem PII" desde a 0085.
 */
import type pg from 'pg';
import { z } from 'zod';

import { logger } from '@/lib/logger';

import { tool } from '../edge/llm/run-model-call';
import { agenteDaCampanhaDaConversa } from './agente-da-campanha';

/** POR QUE a passagem aconteceu — espelha o CHECK da migration 8004 (vinda da 9064). */
export const MOTIVOS_DA_TRANSFERENCIA_DE_AGENTE = [
  'pedido_do_agente',
  'pedido_do_operador',
  'regra_de_automacao',
] as const;
export type MotivoDaTransferenciaDeAgente =
  (typeof MOTIVOS_DA_TRANSFERENCIA_DE_AGENTE)[number];

/** Recusas. Todas garantem a mesma coisa: NADA é escrito. */
export const CODIGOS_DE_RECUSA_DA_TRANSFERENCIA = [
  /** A conversa não existe nesta organização. */
  'conversa_nao_encontrada',
  /** A conversa está encerrada: não há atendimento em que a passagem valha. */
  'conversa_encerrada',
  /** A conversa nasceu de campanha com agente próprio: é ele quem atende. */
  'conversa_de_campanha',
  /** O agente não existe, está arquivado ou não tem versão publicada. */
  'agente_inexistente',
  /** O agente está pausado: o cliente ficaria sem resposta. */
  'agente_pausado',
  /** O agente não atende o número desta conversa. */
  'agente_de_outro_numero',
  /** A conversa já está com esse agente. */
  'ja_esta_no_agente',
] as const;
export type CodigoDeRecusaDaTransferencia =
  (typeof CODIGOS_DE_RECUSA_DA_TRANSFERENCIA)[number];

export class TransferenciaDeAgenteRecusada extends Error {
  constructor(
    readonly codigo: CodigoDeRecusaDaTransferencia,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'TransferenciaDeAgenteRecusada';
  }
}

/** Um agente no ar que atende o número. */
export interface AgenteDoNumero {
  id: string;
  nome: string;
  descricao: string | null;
  pausado: boolean;
}

/**
 * Os agentes que atendem este número: publicados nele ou alcançáveis pelo
 * roteador ativo dele — o MESMO universo de `fn_ia_pode_responder_mensagem` e de
 * `agenteDoEscopoNoNumero` (`resolve-turn-agent.ts`). Pausados vêm marcados,
 * para a ação recusar com o motivo certo.
 */
export async function agentesDoNumero(
  db: pg.Pool,
  organizationId: string,
  channelSessionId: string,
): Promise<AgenteDoNumero[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    description: string | null;
    paused_at: string | null;
  }>(
    `select a.id, a.name, a.description, a.paused_at
       from ai_agents a
       join ai_agent_versions v on v.id = a.published_version_id and v.organization_id = a.organization_id
      where a.organization_id = $1
        and a.archived_at is null
        and v.status = 'published'
        and (v.channel_session_id = $2
             or exists (select 1 from ai_routers r
                         where r.organization_id = $1 and r.is_active and r.channel_session_id = $2
                           and (r.fallback_agent_id = a.id
                                or exists (select 1 from ai_router_members rm
                                            where rm.router_id = r.id and rm.agent_id = a.id))))
      order by a.priority desc, a.created_at, a.id`,
    [organizationId, channelSessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.name,
    descricao: r.description,
    pausado: r.paused_at !== null,
  }));
}

export interface EntradaDaTransferencia {
  organizationId: string;
  conversationId: string;
  agenteDestinoId: string;
  motivo: MotivoDaTransferenciaDeAgente;
  /** O agente que está atendendo agora (o do turno). Sem ele, vale a passagem em vigor. */
  agenteAtualId?: string | null;
  /** Quem pediu, quando foi uma pessoa. O agente em turno não manda. */
  solicitadoPor?: string | null;
  /** O job do turno, quando a ação nasceu dentro de um turno (correlação). */
  jobId?: string | null;
}

export interface ResultadoDaTransferencia {
  agenteAnteriorId: string | null;
  agenteDestinoId: string;
}

interface ConversaRow {
  channel_session_id: string;
  status: string;
  passado: string | null;
}

/**
 * Passa a conversa para outro agente do mesmo número e registra a decisão.
 *
 * Para na primeira recusa, sem tocar em nada. A gravação é UM statement: a
 * conversa muda e a linha de trilha nasce na mesma escrita, ou nada nasce.
 */
export async function transferirAgenteDaConversa(
  db: pg.Pool,
  entrada: EntradaDaTransferencia,
): Promise<ResultadoDaTransferencia> {
  const { organizationId, conversationId, agenteDestinoId, motivo } = entrada;

  const { rows: conversas } = await db.query<ConversaRow>(
    `select c.channel_session_id, c.status,
            public.fn_agente_passado_da_conversa(c.organization_id, c.id) as passado
       from conversations c
      where c.organization_id = $1 and c.id = $2`,
    [organizationId, conversationId],
  );
  const conversa = conversas[0];
  if (conversa === undefined) {
    throw new TransferenciaDeAgenteRecusada('conversa_nao_encontrada', 'Conversa não encontrada nesta organização.');
  }
  if (['closed', 'resolved', 'archived'].includes(conversa.status)) {
    throw new TransferenciaDeAgenteRecusada('conversa_encerrada', 'A conversa está encerrada.');
  }

  const agenteAnteriorId = entrada.agenteAtualId ?? conversa.passado;
  if (agenteAnteriorId === agenteDestinoId) {
    throw new TransferenciaDeAgenteRecusada('ja_esta_no_agente', 'A conversa já está com este agente.');
  }

  if ((await agenteDaCampanhaDaConversa(db, organizationId, conversationId)) !== null) {
    throw new TransferenciaDeAgenteRecusada(
      'conversa_de_campanha',
      'A conversa nasceu de uma campanha com agente próprio — é ele quem atende.',
    );
  }

  const { rows: existe } = await db.query<{ ok: boolean }>(
    `select true as ok
       from ai_agents a
       join ai_agent_versions v on v.id = a.published_version_id and v.organization_id = a.organization_id
      where a.organization_id = $1 and a.id = $2 and a.archived_at is null and v.status = 'published'`,
    [organizationId, agenteDestinoId],
  );
  if (existe.length === 0) {
    throw new TransferenciaDeAgenteRecusada(
      'agente_inexistente',
      'O agente de destino não existe nesta organização ou não tem versão publicada.',
    );
  }
  const doNumero = (await agentesDoNumero(db, organizationId, conversa.channel_session_id)).find(
    (a) => a.id === agenteDestinoId,
  );
  if (doNumero === undefined) {
    throw new TransferenciaDeAgenteRecusada(
      'agente_de_outro_numero',
      'O agente de destino não atende o número desta conversa.',
    );
  }
  if (doNumero.pausado) {
    throw new TransferenciaDeAgenteRecusada(
      'agente_pausado',
      'O agente de destino está pausado — com ele a conversa ficaria sem resposta.',
    );
  }

  const { rowCount } = await db.query(
    `with destino as (
       update conversations
          set agente_passado_id = $3, agente_passado_em = clock_timestamp()
        where organization_id = $1 and id = $2
          and status not in ('closed', 'resolved', 'archived')
        returning id
     )
     insert into ai_router_decisions
       (organization_id, router_id, conversation_id, intent_name, confidence, agent_id,
        outcome, job_id, origem, agente_anterior_id, motivo, solicitado_por)
     select $1, null, d.id, null, null, $3,
            'transferred', $4, 'acao', $5, $6, $7
       from destino d`,
    [
      organizationId,
      conversationId,
      agenteDestinoId,
      entrada.jobId ?? null,
      agenteAnteriorId,
      motivo,
      entrada.solicitadoPor ?? null,
    ],
  );
  if ((rowCount ?? 0) === 0) {
    // Encerrada ou apagada entre a leitura e a escrita: nada foi gravado.
    throw new TransferenciaDeAgenteRecusada('conversa_encerrada', 'A conversa foi encerrada antes da passagem.');
  }

  logger.info('conversa passada para outro agente de IA', {
    organization_id: organizationId,
    conversation_id: conversationId,
    agente_anterior_id: agenteAnteriorId,
    agente_destino_id: agenteDestinoId,
    motivo,
    solicitado_por: entrada.solicitadoPor ?? null,
  });

  return { agenteAnteriorId, agenteDestinoId };
}

/** O texto que o modelo lê na descrição da ferramenta — um agente por linha. */
export function descricaoDosDestinos(destinos: readonly AgenteDoNumero[]): string {
  return destinos
    .map((a) => `- ${a.nome}${a.descricao ? `: ${a.descricao.replace(/\s+/g, ' ').trim()}` : ''}`)
    .join('\n');
}

/**
 * A ferramenta `transfer_to_agent` do agente em turno (motivo `pedido_do_agente`).
 *
 * Só existe quando há OUTRO agente no ar neste número, e o destino é um enum
 * dos nomes deles: o modelo não tem como nomear agente fora da lista. `null` =
 * sem ferramenta neste turno. Recusa vira resultado (`ok: false`), nunca exceção.
 */
export async function ferramentaDePassagemEntreAgentes(
  db: pg.Pool,
  ctx: {
    organizationId: string;
    conversationId: string;
    channelSessionId: string;
    agenteAtualId: string;
    jobId: string;
    noteRunError: (err: Error) => void;
  },
) {
  if ((await agenteDaCampanhaDaConversa(db, ctx.organizationId, ctx.conversationId)) !== null) return null;
  const destinos = (await agentesDoNumero(db, ctx.organizationId, ctx.channelSessionId)).filter(
    (a) => a.id !== ctx.agenteAtualId && !a.pausado,
  );
  const [primeiro, ...demais] = destinos.map((a) => a.nome);
  if (primeiro === undefined) return null;
  const porNome = new Map(destinos.map((a) => [a.nome, a]));

  return tool({
    description:
      'Passa esta conversa para outro agente de IA deste número, quando o assunto do cliente é ' +
      'claramente do outro agente. A partir da PRÓXIMA mensagem do cliente, quem responde é o agente ' +
      'escolhido, e ele vê toda a conversa. Antes de chamar, avise o cliente em uma frase curta que ' +
      'outro atendente vai continuar e termine com uma pergunta simples sobre o que ele precisa, para ' +
      'ele responder já ao novo agente. Não responda você mesmo ao assunto do outro agente. ' +
      'Agentes disponíveis:\n' +
      descricaoDosDestinos(destinos),
    inputSchema: z.object({
      destino: z.enum([primeiro, ...demais]).describe('o nome do agente que deve assumir a conversa'),
    }),
    execute: async ({ destino }: { destino: string }) => {
      const agente = porNome.get(destino);
      if (agente === undefined) {
        return { ok: false, error: { code: 'agente_de_outro_numero', message: 'Destino fora da lista.' } };
      }
      try {
        await transferirAgenteDaConversa(db, {
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          agenteDestinoId: agente.id,
          agenteAtualId: ctx.agenteAtualId,
          motivo: 'pedido_do_agente',
          jobId: ctx.jobId,
        });
        return {
          ok: true,
          status: 'transferida',
          message:
            `Conversa passada para "${destino}", que responde a partir da próxima mensagem do cliente. ` +
            'Se ainda não avisou o cliente, avise agora em uma frase e termine com uma pergunta curta. ' +
            'Não trate do assunto do outro agente.',
        };
      } catch (err) {
        if (err instanceof TransferenciaDeAgenteRecusada) {
          return { ok: false, error: { code: err.codigo, message: err.message } };
        }
        ctx.noteRunError(err instanceof Error ? err : new Error(String(err)));
        return {
          ok: false,
          error: { code: 'internal_error', message: 'erro interno ao passar a conversa — siga atendendo.' },
        };
      }
    },
  });
}
