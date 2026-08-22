/**
 * Memória Geral da Org (Fase 1 do épico harness — spec 2026-07-23).
 *
 * Doc-mãe versionado+ponteiro (mesmo padrão do playbook 0004) + entradas de
 * aprendizado (manual | flywheel aprovado). Resolvida no início de CADA run —
 * sem cache de processo, de propósito: publicar ⇒ próximo turno já vê.
 * O bloco renderizado entra no PREFIXO ESTÁVEL: determinístico byte-a-byte
 * para a mesma versão+entries (ordem estável por created_at, id).
 */
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrgMemoryEntry {
  id: string;
  title: string;
  body: string;
}

export interface LoadedOrgMemory {
  content: string | null;
  entries: OrgMemoryEntry[];
}

export async function loadOrgMemory(db: pg.Pool, tenantId: string): Promise<LoadedOrgMemory> {
  const { rows: docRows } = await db.query<{ content: string }>(
    `select v.content
     from org_memory_pointers p join org_memory_versions v on v.id = p.version_id
     where p.organization_id = $1`,
    [tenantId],
  );
  const { rows: entryRows } = await db.query<OrgMemoryEntry>(
    `select id, title, body
     from org_memory_entries
     where organization_id = $1 and status = 'active'
     order by created_at asc, id asc`,
    [tenantId],
  );
  return { content: docRows[0]?.content ?? null, entries: entryRows };
}

/**
 * Mesma LEITURA, cliente supabase-js — para chamadores fora do worker (o
 * runtime de teste do agente, `lib/ai/runtime/agent.ts`, que roda em
 * request/serverless com `createAdminClient()`, não com um pool `pg`).
 *
 * Existe porque, sem ela, "Testar agente" nunca via a Memória Geral da Org —
 * medido ao vivo: um endereço publicado em /app/ai/memory não aparecia no
 * teste, e o agente escalava pra humano por não ter a informação que a
 * organização já tinha dado. Mesmo par pg/supabase-js de `quemPodeAssumirAgora`
 * (lib/escalacao/disponibilidade.ts) — duas leituras, uma forma de renderizar
 * (`renderOrgMemory`, inalterada).
 */
export async function loadOrgMemoryViaSupabase(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LoadedOrgMemory> {
  const { data: pointerRow } = await supabase
    .from('org_memory_pointers')
    .select('version_id')
    .eq('organization_id', tenantId)
    .maybeSingle();

  let content: string | null = null;
  const versionId = (pointerRow as { version_id?: string } | null)?.version_id;
  if (versionId) {
    const { data: versionRow } = await supabase
      .from('org_memory_versions')
      .select('content')
      .eq('id', versionId)
      .maybeSingle();
    content = (versionRow as { content?: string } | null)?.content ?? null;
  }

  const { data: entryRows } = await supabase
    .from('org_memory_entries')
    .select('id, title, body')
    .eq('organization_id', tenantId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  return { content, entries: (entryRows ?? []) as OrgMemoryEntry[] };
}

/** Bloco do prefixo estável — '' quando a org não tem memória (zero custo). */
export function renderOrgMemory(mem: LoadedOrgMemory): string {
  if (mem.content === null && mem.entries.length === 0) return '';
  const parts: string[] = ['=== memória da organização (regras e aprendizados — valem para TODO atendimento) ==='];
  if (mem.content !== null) parts.push(mem.content.trim());
  if (mem.entries.length > 0) {
    parts.push('--- aprendizados ---');
    for (const e of mem.entries) parts.push(`- ${e.title}: ${e.body}`);
  }
  return parts.join('\n');
}

/** Ordem canônica do prefixo: playbook → memória da org → índice de skills. */
export function composeSystemPrompt(input: {
  playbookPrompt: string;
  orgMemoryBlock: string;
  skillIndex: string;
}): string {
  const blocks = [input.playbookPrompt];
  if (input.orgMemoryBlock !== '') blocks.push(input.orgMemoryBlock);
  if (input.skillIndex !== '') {
    blocks.push(
      `=== skills (índice — o corpo carrega no turno quando a situação dispara) ===\n${input.skillIndex}`,
    );
  }
  return blocks.join('\n\n');
}
