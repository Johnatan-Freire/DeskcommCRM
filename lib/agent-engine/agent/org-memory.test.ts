import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { composeSystemPrompt, loadOrgMemory, loadOrgMemoryViaSupabase, renderOrgMemory } from './org-memory';

function poolSeq(responses: Array<{ rows: unknown[] }>): pg.Pool {
  const query = vi.fn();
  for (const r of responses) query.mockResolvedValueOnce(r);
  return { query } as unknown as pg.Pool;
}

describe('loadOrgMemory', () => {
  it('resolve doc pelo ponteiro e entries active em ordem estável', async () => {
    const pool = poolSeq([
      { rows: [{ content: 'Regras da org.' }] },
      { rows: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }] },
    ]);
    const mem = await loadOrgMemory(pool, 'org1');
    expect(mem).toEqual({ content: 'Regras da org.', entries: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }] });
  });

  it('org sem memória: content null e entries vazias', async () => {
    const mem = await loadOrgMemory(poolSeq([{ rows: [] }, { rows: [] }]), 'org1');
    expect(mem).toEqual({ content: null, entries: [] });
  });
});

describe('loadOrgMemoryViaSupabase — mesma leitura, cliente supabase-js', () => {
  // Achado ao vivo: "Testar agente" (runtime de teste, lib/ai/runtime/agent.ts,
  // que usa createAdminClient()/supabase-js, não um pool pg) nunca via nada
  // publicado em /app/ai/memory — um endereço salvo na memória não aparecia no
  // teste, e o agente escalava pra humano por não ter a informação.
  function dubleSupabase(state: {
    pointer?: { version_id: string } | null;
    version?: { content: string } | null;
    entries?: Array<{ id: string; title: string; body: string }>;
  }) {
    return {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          maybeSingle: () => {
            if (table === 'org_memory_pointers') return Promise.resolve({ data: state.pointer ?? null, error: null });
            if (table === 'org_memory_versions') return Promise.resolve({ data: state.version ?? null, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({ data: table === 'org_memory_entries' ? (state.entries ?? []) : [], error: null }).then(
              resolve,
            ),
        };
        return chain;
      },
    } as never;
  }

  it('resolve doc pelo ponteiro (2 queries) e entries active', async () => {
    const supabase = dubleSupabase({
      pointer: { version_id: 'v1' },
      version: { content: 'Endereço: Rua X, 123.' },
      entries: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }],
    });
    const mem = await loadOrgMemoryViaSupabase(supabase, 'org1');
    expect(mem).toEqual({
      content: 'Endereço: Rua X, 123.',
      entries: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }],
    });
  });

  it('sem ponteiro: content null (não tenta buscar a versão)', async () => {
    const mem = await loadOrgMemoryViaSupabase(dubleSupabase({ pointer: null }), 'org1');
    expect(mem.content).toBeNull();
  });

  it('org sem memória nenhuma: mesmo formato de loadOrgMemory (pg)', async () => {
    const mem = await loadOrgMemoryViaSupabase(dubleSupabase({}), 'org1');
    expect(mem).toEqual({ content: null, entries: [] });
  });
});

describe('renderOrgMemory', () => {
  it('vazio quando não há doc nem entries', () => {
    expect(renderOrgMemory({ content: null, entries: [] })).toBe('');
  });
  it('doc + entries viram bloco determinístico', () => {
    const out = renderOrgMemory({ content: 'Doc.', entries: [{ id: 'e1', title: 'T', body: 'B' }] });
    expect(out).toContain('=== memória da organização (regras e aprendizados — valem para TODO atendimento) ===');
    expect(out).toContain('Doc.');
    expect(out).toContain('- T: B');
  });
});

describe('composeSystemPrompt', () => {
  it('ordem: playbook → memória → índice de skills; blocos vazios somem sem separadores órfãos', () => {
    expect(composeSystemPrompt({ playbookPrompt: 'P', orgMemoryBlock: '', skillIndex: '' })).toBe('P');
    const full = composeSystemPrompt({ playbookPrompt: 'P', orgMemoryBlock: 'M', skillIndex: 'S' });
    expect(full.indexOf('P')).toBeLessThan(full.indexOf('M'));
    expect(full.indexOf('M')).toBeLessThan(full.indexOf('S'));
    expect(full).toContain('=== skills (índice — o corpo carrega no turno quando a situação dispara) ===');
  });
});
