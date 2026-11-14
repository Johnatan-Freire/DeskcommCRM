import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { prepararMaterialDoAgente } from './material-do-agente';

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const CONVERSA = 'cccccccc-0000-4000-8000-000000000001';
const MATERIAL = 'dddddddd-0000-4000-8000-000000000001';
const AGENTE = 'eeeeeeee-0000-4000-8000-000000000001';

function fakeDb(o: { material?: { storage_path: string; mime: string } | null; jaEnviado?: number }) {
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('from materiais_do_agente')) {
      const m = o.material === undefined ? { storage_path: `${ORG}/${MATERIAL}.mp4`, mime: 'video/mp4' } : o.material;
      return { rows: m === null ? [] : [{ id: MATERIAL, titulo: 'Apresentação', ...m }] };
    }
    if (sql.includes('from messages')) {
      // A conferência do reenvio olha ESTE material nesta conversa e desta organização.
      expect(params).toEqual([ORG, CONVERSA, MATERIAL]);
      expect(sql).toContain("metadata->>'material_id' = $3");
      expect(sql).toContain("status <> 'failed'");
      return { rows: [{ n: o.jaEnviado ?? 0 }] };
    }
    throw new Error(`consulta inesperada: ${sql.slice(0, 50)}`);
  });
  return { query } as never;
}

const entrada = { tenantId: ORG, conversationId: CONVERSA, materialId: MATERIAL, agentId: AGENTE };

describe('prepararMaterialDoAgente', () => {
  it('copia para a pasta da conversa, com destino determinístico, e devolve o MIME guardado', async () => {
    const copiar = vi.fn(async () => true);
    const r = await prepararMaterialDoAgente(fakeDb({}), copiar, entrada);
    expect(copiar).toHaveBeenCalledWith(`${ORG}/${MATERIAL}.mp4`, `${ORG}/${CONVERSA}/material-${MATERIAL}.mp4`);
    expect(r).toEqual({
      ok: true,
      titulo: 'Apresentação',
      midia: { storagePath: `${ORG}/${CONVERSA}/material-${MATERIAL}.mp4`, mime: 'video/mp4' },
    });
  });

  it('material inexistente, desativado ou de outro agente: recusa sem copiar', async () => {
    const copiar = vi.fn(async () => true);
    const r = await prepararMaterialDoAgente(fakeDb({ material: null }), copiar, entrada);
    expect(r).toMatchObject({ ok: false, code: 'material_nao_encontrado' });
    expect(copiar).not.toHaveBeenCalled();
  });

  it('o mesmo material não sai duas vezes na mesma conversa (regra do código, não do prompt)', async () => {
    const copiar = vi.fn(async () => true);
    const r = await prepararMaterialDoAgente(fakeDb({ jaEnviado: 1 }), copiar, entrada);
    expect(r).toMatchObject({ ok: false, code: 'material_ja_enviado' });
    expect(copiar).not.toHaveBeenCalled();
  });

  it('cópia que falha não derruba a mensagem: o texto sai sem a mídia', async () => {
    const r = await prepararMaterialDoAgente(fakeDb({}), vi.fn(async () => false), entrada);
    expect(r).toEqual({ ok: true, midia: null, titulo: 'Apresentação' });
  });

  it('caminho de OUTRA organização nunca é copiado (a cópia é por service role)', async () => {
    const copiar = vi.fn(async () => true);
    const r = await prepararMaterialDoAgente(
      fakeDb({ material: { storage_path: `outra-org/${MATERIAL}.mp4`, mime: 'video/mp4' } }),
      copiar,
      entrada,
    );
    expect(copiar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, midia: null });
  });

  it('sem copiador (prévia do botão Testar): só confere', async () => {
    const r = await prepararMaterialDoAgente(fakeDb({}), null, entrada);
    expect(r).toEqual({ ok: true, midia: null, titulo: 'Apresentação' });
  });
});
