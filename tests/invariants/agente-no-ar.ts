/**
 * Fixture compartilhada: um agente NO AR na sessão — publicado, não pausado, e
 * com a ativação (`ai_agents.service_enabled_at`, migration 0403) ANTES das
 * mensagens que o teste vai criar.
 *
 * Por que existe: desde a 0403 a IA só atende mensagem que aconteceu DEPOIS de
 * um agente ser ligado, e o turno sem agente resolvido (o antigo "genérico")
 * não responde mais. Invariantes que rodavam o turno sem agente nenhum, ou que
 * publicavam o agente DEPOIS de inserir a mensagem, passaram a representar um
 * estado em que a IA corretamente não responde. Esta fixture dá a eles o estado
 * que sempre presumiram: "há um agente atendendo este número".
 *
 * `ativoDesde` data a ativação no passado — para o cenário legítimo de mensagem
 * velha por natureza (reengajamento por template com a janela de 24h fechada),
 * em que o agente já estava no ar quando o lead escreveu. A coluna é gravada
 * SÓ por trigger; aqui o trigger é suspenso NESTA transação
 * (`session_replication_role = replica`, só superusuário, desfeito no commit)
 * para forjar o passado — nunca em código de produto.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";

export async function publicarAgenteNaSessao(
  pool: pg.Pool,
  org: string,
  session: string,
  o: { ativoDesde?: string } = {},
): Promise<{ agentId: string; versionId: string }> {
  const agentId = randomUUID();
  const versionId = randomUUID();
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt, kind)
     values ($1, $2, $3, 'você é um atendente', 'mcp_agent')`,
    // `ai_agents_name_unique` é por organização: nome fixo quebraria a 2ª sessão.
    [agentId, org, `Agente no ar ${agentId.slice(0, 8)}`],
  );
  await pool.query(
    `insert into ai_agent_versions (id, organization_id, agent_id, version_number, system_prompt,
                                    provider, model, channel_session_id, status, published_at)
     values ($1, $2, $3, 1, 'você é um atendente', 'anthropic', 'claude-sonnet-4-6', $4, 'published', now())`,
    [versionId, org, agentId, session],
  );
  await pool.query("update ai_agents set published_version_id = $1 where id = $2", [versionId, agentId]);
  if (o.ativoDesde !== undefined) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query("update ai_agents set service_enabled_at = $2 where id = $1", [agentId, o.ativoDesde]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
  return { agentId, versionId };
}
