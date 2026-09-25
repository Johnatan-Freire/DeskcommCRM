import { describe, expect, it } from 'vitest';

import { verificarAutorizacaoTerminal } from './lead-state';

describe('verificarAutorizacaoTerminal — fail-closed (T51/T62)', () => {
  it('won bloqueado quando canMarkWon !== true', () => {
    const r = verificarAutorizacaoTerminal('won', { canMarkWon: false, canMarkLost: true });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('esperava bloqueio');
    expect(r.error.code).toBe('transicao_nao_autorizada');
  });

  it('won permitido quando canMarkWon === true', () => {
    expect(verificarAutorizacaoTerminal('won', { canMarkWon: true, canMarkLost: false })).toEqual({ ok: true });
  });

  it('lost bloqueado quando canMarkLost !== true', () => {
    const r = verificarAutorizacaoTerminal('lost', { canMarkWon: false, canMarkLost: false });
    expect(r.ok).toBe(false);
  });

  it('lost permitido quando canMarkLost === true', () => {
    expect(verificarAutorizacaoTerminal('lost', { canMarkWon: false, canMarkLost: true })).toEqual({ ok: true });
  });

  it('canMarkWon=true sozinho não libera lost, e vice-versa — os dois eixos são independentes', () => {
    expect(verificarAutorizacaoTerminal('lost', { canMarkWon: true, canMarkLost: false }).ok).toBe(false);
    expect(verificarAutorizacaoTerminal('won', { canMarkWon: false, canMarkLost: true }).ok).toBe(false);
  });

  it('T62 — FAIL-CLOSED: autorizacao === null bloqueia won E lost (agentConfig ausente/fallback genérico)', () => {
    expect(verificarAutorizacaoTerminal('won', null).ok).toBe(false);
    expect(verificarAutorizacaoTerminal('lost', null).ok).toBe(false);
  });

  it('estágios não-terminais nunca são bloqueados, mesmo com autorizacao null', () => {
    for (const s of ['new', 'contacted', 'qualifying', 'qualified', 'negotiating'] as const) {
      expect(verificarAutorizacaoTerminal(s, null)).toEqual({ ok: true });
    }
  });
});
