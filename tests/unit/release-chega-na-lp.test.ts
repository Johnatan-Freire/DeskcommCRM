import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TODA RELEASE APARECE NA PÁGINA DE CHANGELOG DA LP — E O CI CONFERE.
 *
 * `docs/doctrine/versionamento.md`, seção "A vitrine". A LP (repositório
 * `deskcomm-site`) tem uma página de changelog em pt-BR, en e es que lê o
 * `CHANGELOG.md` da `main`. No upstream, quem confere que a versão chegou lá é
 * o último passo do job `release.yml::cortar-tag`.
 *
 * Esse job foi REMOVIDO deste fork: exigia RELEASE_APP_ID/
 * RELEASE_APP_PRIVATE_KEY (GitHub App do repositório original), que este fork
 * não tem — ver o cabeçalho de `release.yml`. Os testes que extraíam e
 * executavam o bash do passo da LP saíram junto (`describe.skip` abaixo).
 *
 * O que SOBREVIVE aqui é o contrato que não depende do job: o formato do
 * cabeçalho do CHANGELOG que a LP sabe ler (o mesmo `deskcomm-site/lib/
 * changelog.ts` usa) e a doutrina declarando a vitrine — os dois continuam
 * verdadeiros para este fork independente de quem confere a chegada.
 */
const RAIZ = process.cwd();
const doutrina = readFileSync(join(RAIZ, "docs/doctrine/versionamento.md"), "utf8");
const changelog = readFileSync(join(RAIZ, "CHANGELOG.md"), "utf8");

describe("a release chega à página de changelog da LP", () => {
  it("a doutrina de versionamento declara a vitrine", () => {
    expect(doutrina).toMatch(/^## A vitrine/m);
    expect(doutrina).toContain("deskcomm.com.br/changelog");
    expect(doutrina).toContain("A versão aparece na página de changelog da LP?");
  });

  it("toda seção do CHANGELOG segue o cabeçalho que a LP sabe ler", () => {
    // A mesma expressão de deskcomm-site/lib/changelog.ts (CABECALHO_VERSAO).
    const CABECALHO_VERSAO = /^## \[(\d+\.\d+\.\d+)\]\s*[—–-]\s*(\d{4}-\d{2}-\d{2})\s*$/;
    const cabecalhos = changelog.split("\n").filter((l) => l.startsWith("## "));
    const fora = cabecalhos.filter((l) => !CABECALHO_VERSAO.test(l) && l.trim() !== "## [Não lançado]");
    expect(fora, "seção que a página de changelog da LP não reconheceria").toEqual([]);
    expect(cabecalhos.filter((l) => CABECALHO_VERSAO.test(l)).length).toBeGreaterThan(0);
  });
});

describe.skip("o passo que confere a chegada na LP (job release.yml::cortar-tag não existe neste fork)", () => {
  it("ver o cabeçalho deste arquivo", () => {});
});
