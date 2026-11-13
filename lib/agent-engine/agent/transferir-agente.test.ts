import { describe, expect, it, vi } from 'vitest';

import {
  descricaoDosDestinos,
  ferramentaDePassagemEntreAgentes,
  transferirAgenteDaConversa,
  TransferenciaDeAgenteRecusada,
} from './transferir-agente';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Agente = { id: string; name: string; description: string | null; paused_at: string | null };

const ALUNOS: Agente = { id: 'ag-alunos', name: 'Alunos', description: 'Atende alunos matriculados', paused_at: null };
const COMERCIAL: Agente = { id: 'ag-comercial', name: 'Comercial', description: 'Vende cursos', paused_at: null };

/**
 * Banco falso roteado pelo texto da consulta. `escritas` guarda o statement
 * único da passagem, para provar o que foi gravado (ou que nada foi).
 */
function fakeDb(over: {
  conversa?: { channel_session_id: string; status: string; passado: string | null } | null;
  campanha?: string | null;
  publicado?: boolean;
  doNumero?: Agente[];
  linhasGravadas?: number;
} = {}) {
  const escritas: { sql: string; values: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('fn_agente_passado_da_conversa')) {
      const c = over.conversa === undefined
        ? { channel_session_id: 'sess-1', status: 'open', passado: null }
        : over.conversa;
      return { rows: c === null ? [] : [c] };
    }
    if (sql.includes('campaign_recipients')) {
      return { rows: over.campanha ? [{ agent_id: over.campanha }] : [] };
    }
    if (sql.includes('select true as ok')) return { rows: over.publicado === false ? [] : [{ ok: true }] };
    if (sql.includes('order by a.priority desc')) return { rows: over.doNumero ?? [ALUNOS, COMERCIAL] };
    if (sql.includes('insert into ai_router_decisions')) {
      escritas.push({ sql, values });
      return { rows: [], rowCount: over.linhasGravadas ?? 1 };
    }
    throw new Error(`consulta inesperada: ${sql.slice(0, 60)}`);
  });
  return { db: { query } as never, escritas };
}

const entrada = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  agenteDestinoId: COMERCIAL.id,
  agenteAtualId: ALUNOS.id,
  motivo: 'pedido_do_agente' as const,
  jobId: 'job-1',
};

async function recusa(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (err) {
    if (err instanceof TransferenciaDeAgenteRecusada) return err.codigo;
    throw err;
  }
  throw new Error('a passagem deveria ter sido recusada');
}

describe('transferirAgenteDaConversa', () => {
  it('passa a conversa e grava a mudança e a trilha num statement só', async () => {
    const { db, escritas } = fakeDb();
    const out = await transferirAgenteDaConversa(db, entrada);
    expect(out).toEqual({ agenteAnteriorId: ALUNOS.id, agenteDestinoId: COMERCIAL.id });
    expect(escritas).toHaveLength(1);
    const [{ sql, values }] = escritas as [{ sql: string; values: unknown[] }];
    expect(sql).toContain('set agente_passado_id = $3, agente_passado_em = clock_timestamp()');
    expect(sql).toContain("'transferred'");
    expect(sql).toContain("'acao'");
    expect(values).toEqual(['org-1', 'conv-1', COMERCIAL.id, 'job-1', ALUNOS.id, 'pedido_do_agente', null]);
  });

  it('sem agente atual informado, o agente de origem é a passagem em vigor', async () => {
    const { db } = fakeDb({ conversa: { channel_session_id: 'sess-1', status: 'open', passado: ALUNOS.id } });
    const out = await transferirAgenteDaConversa(db, { ...entrada, agenteAtualId: null });
    expect(out.agenteAnteriorId).toBe(ALUNOS.id);
  });

  const casos: [string, Parameters<typeof fakeDb>[0], Partial<typeof entrada>, string][] = [
    ['conversa de outra organização ou apagada', { conversa: null }, {}, 'conversa_nao_encontrada'],
    ['conversa encerrada', { conversa: { channel_session_id: 'sess-1', status: 'closed', passado: null } }, {}, 'conversa_encerrada'],
    ['destino é o agente que já atende', {}, { agenteDestinoId: ALUNOS.id }, 'ja_esta_no_agente'],
    ['conversa de campanha com agente próprio', { campanha: 'ag-campanha' }, {}, 'conversa_de_campanha'],
    ['destino sem versão publicada', { publicado: false }, {}, 'agente_inexistente'],
    ['destino que não atende este número', { doNumero: [ALUNOS] }, {}, 'agente_de_outro_numero'],
    ['destino pausado', { doNumero: [ALUNOS, { ...COMERCIAL, paused_at: '2026-11-13T10:00:00Z' }] }, {}, 'agente_pausado'],
    ['conversa encerrada entre a leitura e a escrita', { linhasGravadas: 0 }, {}, 'conversa_encerrada'],
  ];
  for (const [nome, banco, mudanca, codigo] of casos) {
    it(`recusa: ${nome} → ${codigo}`, async () => {
      const { db, escritas } = fakeDb(banco);
      expect(await recusa(transferirAgenteDaConversa(db, { ...entrada, ...mudanca }))).toBe(codigo);
      // Toda recusa ANTES da escrita deixa o banco intocado.
      if (banco.linhasGravadas === undefined) expect(escritas).toHaveLength(0);
    });
  }
});

describe('ferramentaDePassagemEntreAgentes', () => {
  const ctx = {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    channelSessionId: 'sess-1',
    agenteAtualId: ALUNOS.id,
    jobId: 'job-1',
    noteRunError: vi.fn(),
  };

  it('só oferece os OUTROS agentes no ar do número, e a descrição diz quem é quem', async () => {
    const { db } = fakeDb({
      doNumero: [ALUNOS, COMERCIAL, { id: 'ag-pausado', name: 'Pausado', description: null, paused_at: 'x' }],
    });
    const t = await ferramentaDePassagemEntreAgentes(db, ctx);
    expect(t).not.toBeNull();
    expect(t!.description).toContain('- Comercial: Vende cursos');
    expect(t!.description).not.toContain('Alunos:');
    expect(t!.description).not.toContain('Pausado');
  });

  it('sem outro agente no número, não há ferramenta', async () => {
    const { db } = fakeDb({ doNumero: [ALUNOS] });
    expect(await ferramentaDePassagemEntreAgentes(db, ctx)).toBeNull();
  });

  it('em conversa de campanha, não há ferramenta', async () => {
    const { db } = fakeDb({ campanha: 'ag-campanha' });
    expect(await ferramentaDePassagemEntreAgentes(db, ctx)).toBeNull();
  });

  it('executar passa a conversa; recusa volta como resultado, nunca exceção', async () => {
    const ok = fakeDb();
    const t = await ferramentaDePassagemEntreAgentes(ok.db, ctx);
    const execute = t!.execute as (i: { destino: string }, o: unknown) => Promise<{ ok: boolean; error?: { code: string } }>;
    expect((await execute({ destino: 'Comercial' }, {})).ok).toBe(true);
    expect(ok.escritas).toHaveLength(1);

    const fechada = fakeDb({ linhasGravadas: 0 });
    const t2 = await ferramentaDePassagemEntreAgentes(fechada.db, ctx);
    const execute2 = t2!.execute as typeof execute;
    const out = await execute2({ destino: 'Comercial' }, {});
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('conversa_encerrada');
  });
});

describe('descricaoDosDestinos', () => {
  it('uma linha por agente, sem quebras de linha da descrição', () => {
    expect(
      descricaoDosDestinos([
        { id: 'a', nome: 'Comercial', descricao: 'Vende\n cursos', pausado: false },
        { id: 'b', nome: 'Secretaria', descricao: null, pausado: false },
      ]),
    ).toBe('- Comercial: Vende cursos\n- Secretaria');
  });
});
