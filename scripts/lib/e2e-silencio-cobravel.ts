/**
 * O ESTADO QUE A VARREDURA DE SILÊNCIO COBRA — para os helpers de e2e.
 *
 * Os seeds de silêncio criavam só o inbound velho. Duas regras posteriores tornaram
 * esse estado incobrável por construção, e os e2e ficaram esperando o comportamento velho:
 *
 *   · migration 0403 (`fn_silencio_pode_reengajar`) — o cliente falou por último é a empresa
 *     devendo resposta (`contato_aguardando_resposta`), e a mensagem tem de ser posterior à
 *     conexão do número (0398) e à ativação do agente;
 *   · dono da pendência (`lib/followup/origem-da-pendencia.ts`) — a última fala da IA depois
 *     do último inbound tem de ser de um agente que HABILITA o fluxo.
 *
 * Aqui mora a fixture certa: número e agente "no ar há uma hora", o cliente escreveu, a IA
 * respondeu (assinada por `autorDaFala`) e ele calou.
 *
 * ⚠️ Retroagir conexão e ativação é estado de FIXTURE e só roda em banco LOCAL. A conexão
 * aceita UPDATE direto (o trigger dela é `coalesce`). A ativação não:
 * `trg_ai_agents_inicio_do_atendimento` a regrava em todo UPDATE, de propósito — a
 * aplicação não move a data. Desligar SÓ esse trigger dentro de uma transação é
 * transacional (nenhuma outra sessão o vê desligado) e ele volta antes do commit. O
 * threshold mínimo do gatilho é 5 min, então esperar em tempo real não cabe num e2e.
 */
import type pg from "pg";

import { destinoEhLocal } from "./env-de-teste";

export interface SilencioCobravel {
  dbUrl: string;
  orgId: string;
  channelSessionId: string;
  conversationId: string;
  contactId: string;
  /** Agente publicado que habilita o fluxo — é a ativação DELE que retroage. */
  agentId: string;
  /** Quem assina a fala da IA. Default: `agentId`. Outro id = o caso "pendência de outro agente". */
  autorDaFala?: string;
  /** Instante do inbound (mais velho que o threshold do gatilho). */
  inboundAt: string;
}

export async function semearSilencioCobravel(pool: pg.Pool, s: SilencioCobravel): Promise<void> {
  if (!destinoEhLocal(s.dbUrl)) {
    throw new Error("semearSilencioCobravel recusa banco que não é local (retroage ativação/conexão)");
  }

  const cli = await pool.connect();
  try {
    await cli.query("begin");
    await cli.query(
      `update channel_sessions
          set first_connected_at = least(coalesce(first_connected_at, now()), now() - interval '1 hour')
        where id = $1 and organization_id = $2`,
      [s.channelSessionId, s.orgId],
    );
    await cli.query("alter table public.ai_agents disable trigger trg_ai_agents_inicio_do_atendimento");
    await cli.query(
      `update ai_agents
          set service_enabled_at = least(coalesce(service_enabled_at, now()), now() - interval '1 hour')
        where id = $1 and organization_id = $2 and published_version_id is not null`,
      [s.agentId, s.orgId],
    );
    await cli.query("alter table public.ai_agents enable trigger trg_ai_agents_inicio_do_atendimento");
    await cli.query("commit");
  } catch (e) {
    await cli.query("rollback").catch(() => {});
    throw e;
  } finally {
    cli.release();
  }

  // O carimbo do atendimento não se escreve aqui: `fn_service_inbound` dispara no INSERT.
  await pool.query(
    `insert into messages
       (organization_id, conversation_id, channel_session_id, contact_id,
        type, direction, status, sent_via, body, sent_at)
     values ($1, $2, $3, $4, 'text', 'inbound', 'received', 'external_device', 'Oi, tudo bem?', $5)`,
    [s.orgId, s.conversationId, s.channelSessionId, s.contactId, s.inboundAt],
  );
  // A IA respondeu 1s depois — e é a ÚLTIMA mensagem: é ela que o silêncio cobra.
  await pool.query(
    `insert into messages
       (organization_id, conversation_id, channel_session_id, contact_id,
        type, direction, status, sent_via, body, sent_at, metadata)
     values ($1, $2, $3, $4, 'text', 'outbound', 'sent', 'ai', 'Oi! Posso ajudar?', $5, $6::jsonb)`,
    [
      s.orgId, s.conversationId, s.channelSessionId, s.contactId,
      new Date(Date.parse(s.inboundAt) + 1_000).toISOString(),
      JSON.stringify({ ai_actor_id: s.autorDaFala ?? s.agentId }),
    ],
  );
}
