/**
 * A PROTEÇÃO SOB O `ensure_rls` É O ÚLTIMO BLOCO DO BASELINE — e tem de continuar sendo.
 *
 * `fn_proteger_tabelas_sob_ensure_rls` (migration 0521) dá a policy de
 * isolamento à tabela de organização com RLS ligada e NENHUMA policy permissiva.
 * Isso só é seguro quando todas as policies do arquivo já foram criadas: há
 * tabelas que ligam a RLS cedo e ganham as próprias policies muito depois
 * (`conversation_notes`: RLS na 0198, policies na 0478). Rodada no meio do
 * arquivo, a régua daria a elas a policy AMPLA antes das próprias — acesso a
 * mais, que ninguém remove depois (medido: os invariantes de notas internas
 * ficaram vermelhos quando a régua rodou cedo).
 *
 * Por isso a chamada fica no fim, e apêndice novo entra ACIMA dela. Estático,
 * pelo mesmo motivo de `varredura-anon-e-o-ultimo-bloco.test.ts`: a ordem é
 * propriedade do arquivo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fonte = readFileSync(join(process.cwd(), "supabase/baseline.sql"), "utf8");

/** Statements do arquivo sem comentários de linha, na ordem. */
function ultimoStatement(sql: string): string {
  const semComentario = sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n")
    .trim();
  const i = semComentario.lastIndexOf("do $f$ begin");
  return i < 0 ? "" : semComentario.slice(i);
}

describe("baseline.sql — a proteção sob o ensure_rls é o último bloco", () => {
  it("o último statement do arquivo chama fn_proteger_tabelas_sob_ensure_rls e depois as travas", () => {
    const ultimo = ultimoStatement(fonte);
    expect(ultimo, "o arquivo não termina com o bloco da 0521").toMatch(
      /^do \$f\$ begin\s+perform public\.fn_proteger_tabelas_sob_ensure_rls\(\);\s+perform public\.fn_aplicar_travas_de_suporte\(\);\s+end \$f\$;$/,
    );
  });

  it("a função não é chamada em nenhum outro ponto do arquivo (no meio, ela daria acesso a mais)", () => {
    const chamadas = fonte.split("\n").filter((l) => !/^\s*--/.test(l) && /perform public\.fn_proteger_tabelas_sob_ensure_rls\(\)/.test(l));
    expect(chamadas).toHaveLength(1);
  });
});
