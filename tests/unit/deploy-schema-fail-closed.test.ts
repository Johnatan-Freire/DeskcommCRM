/**
 * DEPLOY NÃO PODE ENGOLIR ERRO REAL DE SCHEMA — NEM APLICÁ-LO COM O SISTEMA NO AR.
 *
 * ## Por que este arquivo existe
 *
 * Medido em produção em 2026-09-25: a migration 0401 estava no `baseline.sql`
 * reaplicado pelo `deploy.yml`, mas as colunas nunca chegaram à tabela — o
 * workflow filtrava os erros por regex e, quando sobrava algo inesperado, só
 * avisava e seguia para o `up -d`. O conserto trocou isso por
 * `reaplicar_baseline` (`hostgator-setup-kit/_common.sh`), o mesmo mecanismo do
 * `update.sh`, provado em `tests/shell/baseline-reaplica-apos-disputa.test.sh`.
 *
 * Medido de novo em 2026-09-26: com o erro agora obedecido, as duas rodadas do
 * deploy morreram em `deadlock detected` nas três passadas — app, worker e
 * scheduler seguiam no ar disputando lock com o baseline. O passo remoto foi
 * para `scripts/deploy-vps.sh`, que PAUSA o sistema antes de aplicar (como o
 * `update.sh`) e só quando o baseline mudou.
 *
 * ## O que ESTE arquivo prova
 *
 * O COMPORTAMENTO do script (ordem das chamadas, fail-closed, marca) é provado
 * com dublê de docker em `tests/shell/deploy-vps.test.sh`. Aqui fica o que é
 * textual e barato: que o `deploy.yml` chama o script, e que o script mantém as
 * propriedades que já custaram um deploy cada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOW = join(process.cwd(), ".github/workflows/deploy.yml");
const SCRIPT = join(process.cwd(), "scripts/deploy-vps.sh");

/** O bloco remoto é tudo entre a linha do `ssh ... VPS_SSH_HOST` e a aspas simples de fechamento, sozinha na linha. */
function extrairBlocoRemoto(): string {
  const linhas = readFileSync(WORKFLOW, "utf8").split("\n");
  const iInicio = linhas.findIndex((l) => l.includes("VPS_SSH_HOST"));
  if (iInicio === -1) throw new Error("linha com VPS_SSH_HOST não encontrada em deploy.yml");
  const iFim = linhas.findIndex((l, i) => i > iInicio && /^\s*'\s*$/.test(l));
  if (iFim === -1) throw new Error("linha de fechamento (aspas simples sozinha) não encontrada após VPS_SSH_HOST");
  return linhas.slice(iInicio + 1, iFim).join("\n");
}

const script = () => readFileSync(SCRIPT, "utf8");
const codigo = () =>
  script()
    .split("\n")
    .filter((l) => !/^\s*#/.test(l));

describe("deploy.yml → scripts/deploy-vps.sh", () => {
  it("controle positivo: o bloco remoto sincroniza o código e DEPOIS chama o script", () => {
    const bloco = extrairBlocoRemoto();
    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).toMatch(/^\s*set -euo pipefail\s*$/m);
    const iReset = bloco.indexOf("git reset --hard FETCH_HEAD");
    const iScript = bloco.indexOf("bash scripts/deploy-vps.sh");
    expect(iReset).toBeGreaterThan(-1);
    expect(iScript, "o script roda na versão que o reset trouxe").toBeGreaterThan(iReset);
  });

  it("não sobrou o padrão antigo (grep manual + aviso sem exit) — nem no workflow, nem no script", () => {
    for (const texto of [extrairBlocoRemoto(), script()]) {
      expect(texto).not.toMatch(/inesperado="\$\(printf/);
      expect(texto).not.toContain('benigno="already exists');
      expect(texto).not.toContain("avisos inesperados ao reaplicar");
    }
  });
});

describe("scripts/deploy-vps.sh — fail-closed e sem disputa de lock", () => {
  it("roda sob set -euo pipefail — um exit 1 de fato aborta", () => {
    expect(script()).toMatch(/^set -euo pipefail$/m);
  });

  it("usa reaplicar_baseline do kit, com o baseline por caminho ABSOLUTO", () => {
    // Medido no 1º deploy real (2026-09-26): caminho relativo o Docker lê como
    // nome de volume ("includes invalid characters for a local volume name").
    const s = script();
    expect(s).toContain("source hostgator-setup-kit/_common.sh");
    expect(s).toContain("enter_project");
    expect(s).toContain('BASELINE="$PROJECT_DIR/supabase/baseline.sql"');
    expect(s).toContain('if reaplicar_baseline "$BASELINE"');
  });

  it("para app/worker/scheduler ANTES do baseline, e o exit 1 do erro vem ANTES do up -d", () => {
    const linhas = codigo();
    const iStop = linhas.findIndex((l) => /dcp stop "\$\{SERVICOS\[@\]\}"/.test(l));
    const iChamada = linhas.findIndex((l) => l.includes("if reaplicar_baseline"));
    const iElse = linhas.findIndex((l, i) => i > iChamada && /^\s*else\s*$/.test(l));
    const iExit = linhas.findIndex((l, i) => i > iElse && /\bexit 1\b/.test(l));
    const iUp = linhas.findIndex((l) => /dcp up -d "\$\{SERVICOS\[@\]\}"/.test(l));

    expect(iStop, "stop dos serviços").toBeGreaterThan(-1);
    expect(iChamada, "chamada do baseline").toBeGreaterThan(iStop);
    expect(iElse).toBeGreaterThan(iChamada);
    expect(iExit, "exit 1 no else").toBeGreaterThan(iElse);
    expect(iUp, "up -d depois do exit").toBeGreaterThan(iExit);
  });

  it("confere as regras de isolamento antes de subir, e só grava a marca depois", () => {
    const linhas = codigo();
    const iConfere = linhas.findIndex((l) => l.includes('faltando="$(regras_de_isolamento_faltando)"'));
    const iMarca = linhas.findIndex((l) => /> "\$MARCA"/.test(l));
    const iUp = linhas.findIndex((l) => /dcp up -d/.test(l));
    expect(iConfere).toBeGreaterThan(-1);
    expect(iMarca).toBeGreaterThan(iConfere);
    expect(iUp).toBeGreaterThan(iMarca);
  });
});
