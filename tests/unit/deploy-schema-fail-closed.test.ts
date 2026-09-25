/**
 * DEPLOY.YML NÃO PODE ENGOLIR ERRO REAL DE SCHEMA.
 *
 * ## Por que este arquivo existe
 *
 * Medido em produção em 2026-09-25: a migration 0401 (colunas `can_mark_won`/
 * `can_mark_lost` em `ai_agent_versions`, o guard fail-closed do agente
 * comercial) estava presente e correta no `baseline.sql` reaplicado pelo
 * `deploy.yml`, mas as duas colunas nunca chegaram a existir na tabela. A causa
 * não foi o SQL — foi o próprio workflow: ele capturava a saída do `psql -f`,
 * filtrava erros "benignos" por regex e, quando sobrava algo INESPERADO, só
 * imprimia um aviso (`echo "⚠ avisos inesperados..."`) e seguia direto para
 * `docker compose pull`/`up -d` de qualquer jeito. Um erro real de schema
 * silenciosamente não bloqueava nada — só um `git grep` manual no log do
 * Actions (que este projeto não tem `gh`/token pra consultar rotineiramente)
 * revelaria a causa.
 *
 * O conserto trocou o grep manual (sem retry, sem exit) por `reaplicar_baseline`
 * (`hostgator-setup-kit/_common.sh`) — o MESMO mecanismo que `update.sh` do kit
 * self-host usa, já exaustivamente provado por
 * `tests/shell/baseline-reaplica-apos-disputa.test.sh` (erro benigno/disputa
 * tenta de novo até 3 passadas; erro real devolve `rc=1`; conexão que cai no
 * meio sem a palavra ERROR também é pega pelo código de saída do psql).
 *
 * ## O que ESTE arquivo prova, e o que ele conscientemente NÃO reprova
 *
 * `reaplicar_baseline` decidir certo (benigno vs real) já está provado noutro
 * arquivo. O que faltava provar é ESPECÍFICO de `deploy.yml`: que o resultado
 * dela é OBEDECIDO — erro real vira `exit 1` ANTES do `pull`/`up -d`, dentro do
 * MESMO bloco remoto que roda sob `set -euo pipefail` (então esse `exit 1`
 * de fato aborta o script, em vez de só imprimir e continuar). Não há aqui um
 * SSH real nem um Postgres real — replicar isso pediria simular a VPS inteira
 * pra provar uma coisa que é de CONTROLE DE FLUXO textual, não de lógica SQL.
 *
 * ## Sem parser YAML nas dependências
 *
 * Mesma limitação (e a mesma solução) de `workflows-tem-permissions.test.ts`:
 * extração por marcador + CONTROLE POSITIVO no primeiro teste, para o gate não
 * ficar verde vigiando lista vazia se o arquivo mudar de formato.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CAMINHO = join(process.cwd(), ".github/workflows/deploy.yml");

/** O bloco remoto é tudo entre a linha do `ssh ... VPS_SSH_HOST` e a aspas simples de fechamento, sozinha na linha. */
function extrairPassoDeSchema(): string {
  const linhas = readFileSync(CAMINHO, "utf8").split("\n");
  const iInicio = linhas.findIndex((l) => l.includes("VPS_SSH_HOST"));
  if (iInicio === -1) throw new Error("linha com VPS_SSH_HOST não encontrada em deploy.yml");
  const iFim = linhas.findIndex((l, i) => i > iInicio && /^\s*'\s*$/.test(l));
  if (iFim === -1) throw new Error("linha de fechamento (aspas simples sozinha) não encontrada após VPS_SSH_HOST");
  return linhas.slice(iInicio + 1, iFim).join("\n");
}

describe("deploy.yml — erro real de schema derruba o deploy (fail-closed)", () => {
  it("controle positivo: o instrumento acha o bloco remoto, e ele contém o up -d esperado", () => {
    const bloco = extrairPassoDeSchema();
    expect(bloco.length).toBeGreaterThan(200);
    expect(bloco).toContain("docker compose -f docker-compose.prod.yml up -d app worker scheduler");
  });

  it("usa reaplicar_baseline (mecanismo testado, com retry em disputa benigna) — não grep manual", () => {
    const bloco = extrairPassoDeSchema();
    expect(bloco).toContain("source hostgator-setup-kit/_common.sh");
    expect(bloco).toContain("enter_project");
    expect(bloco).toContain("reaplicar_baseline supabase/baseline.sql");
  });

  it("em erro real, sai com exit 1 ANTES do pull e do up -d dos containers", () => {
    const bloco = extrairPassoDeSchema();
    const linhas = bloco.split("\n");
    const iChamada = linhas.findIndex((l) => l.includes("if reaplicar_baseline"));
    const iElse = linhas.findIndex((l, i) => i > iChamada && /^\s*else\s*$/.test(l));
    const iExit = linhas.findIndex((l, i) => i > iElse && /\bexit 1\b/.test(l));
    const iPull = linhas.findIndex((l) => l.includes("docker compose -f docker-compose.prod.yml pull"));
    const iUp = linhas.findIndex((l) => l.includes("docker compose -f docker-compose.prod.yml up -d"));

    expect(iChamada, "chamada `if reaplicar_baseline ...`").toBeGreaterThan(-1);
    expect(iElse, "branch else do resultado, depois da chamada").toBeGreaterThan(iChamada);
    expect(iExit, "`exit 1` dentro do else").toBeGreaterThan(iElse);
    expect(iPull, "linha do pull").toBeGreaterThan(-1);
    expect(iUp, "linha do up -d").toBeGreaterThan(-1);
    expect(iExit, "exit 1 vem ANTES do pull").toBeLessThan(iPull);
    expect(iExit, "exit 1 vem ANTES do up -d").toBeLessThan(iUp);
  });

  it("não sobrou o padrão antigo (grep manual + aviso sem exit) — regressão ficaria visível aqui", () => {
    const bloco = extrairPassoDeSchema();
    expect(bloco).not.toMatch(/inesperado="\$\(printf/);
    expect(bloco).not.toContain('benigno="already exists');
    expect(bloco).not.toContain("avisos inesperados ao reaplicar");
  });

  it("o bloco remoto roda sob set -euo pipefail — um exit 1 nele de fato aborta o script", () => {
    const bloco = extrairPassoDeSchema();
    expect(bloco).toMatch(/^\s*set -euo pipefail\s*$/m);
  });
});
