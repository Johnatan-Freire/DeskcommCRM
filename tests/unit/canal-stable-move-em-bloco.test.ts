import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O CANAL `stable` MOVE EM BLOCO, NUNCA POR IMAGEM.
 *
 * ## O que aconteceu (achado ao triar o CHANGELOG do upstream)
 *
 * Medido pelo upstream (melgarafael/DeskcommCRM) no registro público durante o
 * corte da v1.12.0 deles, com sonda de DIGEST — a ingênua ("a tag `stable`
 * existe?") devolve `200` nas três e não prova nada, porque `stable` já existia
 * de uma versão anterior:
 *
 *     deskcommcrm          1.12.0   404
 *     deskcommcrm          stable   sha256:0235d02b…   ← 1.11.0
 *     deskcomm-worker      stable   sha256:66c7bde4…   ← 1.12.0
 *     deskcomm-scheduler   stable   sha256:ac6b87cc…   ← 1.12.0
 *
 * Quem instalasse por `stable` naquela janela recebia **app 1.11.0 com worker e
 * scheduler 1.12.0**. Os três serviços saem do mesmo repositório e compartilham
 * código; rodar dois numa versão e o terceiro noutra é um estado que nenhum
 * teste cobre e que ninguém escolheu.
 *
 * A causa foi de FORMA, não de conteúdo: `type=raw,value=stable` vivia dentro do
 * job da matriz do NOSSO `publish-image.yml` (idêntico ao deles nesse ponto),
 * então cada imagem movia o canal sozinha, sem saber se as irmãs conseguiram.
 *
 * ## Por que entra aqui mesmo sem termos `cortar-tag`
 *
 * Este fork não corta release numerada hoje — o deploy é a cada merge na main,
 * pela tag `latest` (ver `.github/workflows/deploy.yml` e o cabeçalho de
 * `release.yml`, que documenta a remoção do job `cortar-tag`). Ou seja, a
 * condição que move `stable` (`ref_type == 'tag' && startsWith(…, 'v')`) hoje
 * nunca é verdadeira na prática — o caminho está DORMENTE, não ativo.
 *
 * Ainda assim vale corrigir a FORMA: o `release.yml` do fork já convida
 * explicitamente a trazer `cortar-tag` de volta no futuro ("é só criar o
 * GitHub App, cadastrar os dois secrets..."), e nesse dia o defeito estaria
 * esperando, idêntico ao que already causou o incidente medido no upstream.
 * Corrigir agora, com o caminho frio, custa uma revisão; corrigir depois, com
 * o caminho quente e um self-hoster recebendo versões misturadas, custa uma
 * investigação de produção.
 *
 * ## Por que `fail-fast: true` não seria o conserto
 *
 * É o conserto óbvio e ele chega tarde: quando um job da matriz falha, as
 * irmãs já tinham publicado e já tinham movido `stable`. Abortá-las não desfaz
 * o que já foi publicado. O que separa os dois atos é publicar por NÚMERO
 * sempre (cada imagem, independente) e mover o CANAL num job final, quando o
 * conjunto está completo.
 *
 * ## O que este arquivo prova, e o que ele NÃO prova
 *
 * Ele mede a FORMA do YAML. A prova de comportamento só existiria num push de
 * tag real — o único evento que moveria `stable` — e este fork não gera esse
 * evento hoje. Sem `cortar-tag`/`release.yml` cortando tag, não há o segundo
 * teste do upstream (a conferência de digest no corte da release) para portar.
 */
const RAIZ = process.cwd();
const publish = readFileSync(join(RAIZ, ".github/workflows/publish-image.yml"), "utf8");

/**
 * O corpo de um job, do cabeçalho até o próximo job.
 *
 * Começa no bloco `jobs:` de propósito: `on:` tem `  push:` na mesma indentação
 * de um job, e um helper que varra o arquivo inteiro devolveria aquilo como se
 * fosse job.
 */
function job(yml: string, nome: string): string {
  const linhas = yml.split("\n");
  const iJobs = linhas.findIndex((l) => /^jobs:\s*$/.test(l));
  if (iJobs === -1) return "";
  const i = linhas.findIndex((l, n) => n > iJobs && l === `  ${nome}:`);
  if (i === -1) return "";
  const fim = linhas.findIndex((l, n) => n > i && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
  return linhas.slice(i, fim === -1 ? undefined : fim).join("\n");
}

/** O mesmo corpo, sem os comentários. */
function corpo(yml: string, nome: string): string {
  const t = job(yml, nome);
  expect(t, `o job \`${nome}\` sumiu de publish-image.yml`).not.toBe("");
  return t
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
}

const IMAGENS = ["deskcommcrm", "deskcomm-worker", "deskcomm-scheduler"];

describe("o canal `stable` move em bloco", () => {
  it("o instrumento está vivo: enxerga os jobs de publish-image.yml", () => {
    // Controle positivo. Sem ele, um helper que parou de casar devolve "" e as
    // asserções de ausência abaixo passam por vacuidade — vigiando nada.
    expect(job(publish, "build-and-push")).not.toBe("");
    expect(job(publish, "imagens-ok")).not.toBe("");
    expect(job(publish, "build-and-push")).toContain("matrix:");
  });

  it("nenhuma imagem move o canal sozinha dentro da matriz", () => {
    const linhas = corpo(publish, "build-and-push")
      .split("\n")
      .filter((l) => l.includes("value=stable"));
    expect(
      linhas,
      "`stable` de volta na matriz: cada imagem volta a mover o canal sem saber das irmãs",
    ).toEqual([]);
  });

  it("o job de promoção espera as três imagens E o boot do app — nem uma a menos", () => {
    const needs = /needs:\s*\[([^\]]*)\]/.exec(corpo(publish, "promover-stable"))?.[1];
    expect(needs, "o job de promoção não declara `needs`").toBeDefined();
    // Conjunto exato, não `toContain`: exigir a presença de um deixaria remover
    // o outro, e é a remoção que reabre o buraco.
    expect(needs?.split(",").map((s) => s.trim()).sort()).toEqual([
      "build-and-push",
      "imagem-do-app-sobe",
    ]);
  });

  it("a promoção NÃO roda com `always()` — isso a faria promover por cima de uma irmã que falhou", () => {
    expect(corpo(publish, "promover-stable")).not.toMatch(/always\(\)/);
  });

  it("as três imagens são promovidas — o canal não anda pela metade nem aqui", () => {
    const t = corpo(publish, "promover-stable");
    for (const img of IMAGENS) expect(t, `a promoção não cita ${img}`).toContain(img);
  });

  it("a promoção REAPONTA o manifesto publicado, nunca reconstrói", () => {
    // Reconstruir o mesmo commit dá um digest DIFERENTE — foi o que causou o
    // incidente medido pelo upstream, com `stable` e a versão divergindo com o
    // mesmo `revision`. `imagetools create` copia o índice que já existe.
    expect(corpo(publish, "promover-stable")).toMatch(/imagetools create/);
  });

  it("o canal só se move num push de tag `vX.Y.Z`", () => {
    const cond = / {4}if:\s*(.+)/.exec(corpo(publish, "promover-stable"))?.[1] ?? "";
    // As três condições, e cada uma barra um caminho medido: sem `push`, um
    // dispatch numa release ANTIGA faria `stable` REGREDIR; sem `tag`, um
    // dispatch numa branch moveria o canal; sem o `v`, uma tag de teste o move.
    expect(cond).toContain("github.event_name == 'push'");
    expect(cond).toContain("github.ref_type == 'tag'");
    expect(cond).toContain("startsWith(github.ref_name, 'v')");
  });

  it("a promoção declara o privilégio que ela usa, no menor escopo", () => {
    expect(corpo(publish, "promover-stable")).toMatch(/^ {6}packages: write$/m);
  });
});
