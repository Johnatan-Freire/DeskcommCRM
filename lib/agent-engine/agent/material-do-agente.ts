/**
 * O MATERIAL VAI JUNTO — o agente envia um vídeo, imagem ou PDF cadastrado pela
 * equipe em "Materiais do agente" (migration 8006).
 *
 * Mesmo caminho da foto do catálogo (`fotos-do-produto.ts`): o arquivo é COPIADO
 * do bucket `agent-materials` para `whatsapp-media/<org>/<conversa>/material-<id>.<ext>`,
 * e é essa cópia que a mensagem leva. A conversa possui a cópia — a inbox a
 * mostra, a LGPD a apaga junto com a conversa — e o material não perde nada.
 * O destino é determinístico: o replay de um job que caiu depois da cópia
 * reaproveita o arquivo.
 *
 * Três recusas, todas ANTES de enviar qualquer coisa, que voltam ao modelo como
 * erro de ensino:
 *   - `material_nao_encontrado`: não existe, está desativado ou não é deste agente;
 *   - `material_ja_enviado`: já saiu nesta conversa (`messages.metadata.material_id`).
 *     A regra é do código, não só do prompt;
 *   - `material_com_produto`: junto com `produto_codigo`, a mensagem levaria
 *     duas mídias, e o modelo escolhe uma.
 *
 * Arquivo que não copia NÃO derruba a mensagem: o texto sai, e quem chama avisa
 * o modelo de que o material não foi junto.
 */
import { BUCKET_DOS_MATERIAIS } from '@/lib/ai/materiais-do-agente';
import { createAdminClient } from '@/lib/supabase/admin';

import type { Queryable } from '../queue/queue';
import type { FotoParaEnvio } from './fotos-do-produto';

const BUCKET_DA_CONVERSA = 'whatsapp-media';

/** Copia do bucket de materiais para a conversa. `true` = o arquivo está no destino. */
export type CopiarMaterial = (origem: string, destino: string) => Promise<boolean>;

interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export function copiarMaterialNoStorage(log: Log): CopiarMaterial {
  return async (origem, destino) => {
    const { error } = await createAdminClient()
      .storage.from(BUCKET_DOS_MATERIAIS)
      .copy(origem, destino, { destinationBucket: BUCKET_DA_CONVERSA });
    if (!error) return true;
    if (/already exists/i.test(error.message) || (error as { statusCode?: string }).statusCode === '409') {
      return true;
    }
    log.warn('material do agente não copiado para a conversa', { detalhe: error.message.slice(0, 120) });
    return false;
  };
}

export type MaterialPreparado =
  | {
      ok: true;
      /** `null` = a cópia falhou: o texto sai sozinho. */
      midia: FotoParaEnvio | null;
      titulo: string;
    }
  | {
      ok: false;
      code: 'material_nao_encontrado' | 'material_ja_enviado';
      message: string;
    };

/**
 * Confere o material para ESTE agente nesta conversa e deixa o arquivo pronto
 * na pasta da conversa. `copiar` é injetável para o teste não tocar no Storage;
 * `null` em `copiar` = só conferir (o modo prévia do botão Testar).
 */
export async function prepararMaterialDoAgente(
  db: Queryable,
  copiar: CopiarMaterial | null,
  input: { tenantId: string; conversationId: string; materialId: string; agentId: string | null },
): Promise<MaterialPreparado> {
  const { rows } = await db.query<{ id: string; titulo: string; storage_path: string; mime: string }>(
    `select id, titulo, storage_path, mime
       from materiais_do_agente
      where organization_id = $1 and id::text = $2 and ativo
        and (cardinality(agente_ids) = 0 or $3::uuid = any(agente_ids))`,
    [input.tenantId, input.materialId.trim(), input.agentId],
  );
  const material = rows[0];
  if (!material) {
    return {
      ok: false,
      code: 'material_nao_encontrado',
      message:
        `não há material ativo com o id ${JSON.stringify(input.materialId)} para este agente. Use um ` +
        '`material_id` da lista MATERIAIS PARA ENVIAR, ou envie sem material_id.',
    };
  }

  const { rows: enviados } = await db.query<{ n: number }>(
    `select count(*)::int as n
       from messages
      where organization_id = $1 and conversation_id::text = $2
        and direction = 'outbound' and status <> 'failed'
        and metadata->>'material_id' = $3`,
    [input.tenantId, input.conversationId, material.id],
  );
  if ((enviados[0]?.n ?? 0) > 0) {
    return {
      ok: false,
      code: 'material_ja_enviado',
      message:
        `o material "${material.titulo}" já foi enviado nesta conversa. Não reenvie: responda só com texto ` +
        '(se fizer sentido, lembre o cliente do material que ele já recebeu).',
    };
  }

  if (copiar === null) return { ok: true, midia: null, titulo: material.titulo };

  // Só caminho DESTA organização: a cópia é por service role.
  if (!material.storage_path.startsWith(`${input.tenantId}/`)) {
    return { ok: true, midia: null, titulo: material.titulo };
  }
  const ext = material.storage_path.split('.').pop() ?? 'bin';
  const destino = `${input.tenantId}/${input.conversationId}/material-${material.id}.${ext}`;
  const copiou = await copiar(material.storage_path, destino);
  return {
    ok: true,
    midia: copiou ? { storagePath: destino, mime: material.mime } : null,
    titulo: material.titulo,
  };
}
