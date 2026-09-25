import { describe, it } from "vitest";

/**
 * A GUARDA DA RELEASE CONFERE IDENTIDADE, E NÃO NOME — issue #478 (upstream).
 *
 * Este arquivo testava o bash do passo "Este push foi um corte de release?",
 * dentro do job `release.yml::cortar-tag`. Esse job foi REMOVIDO deste fork:
 * exigia RELEASE_APP_ID/RELEASE_APP_PRIVATE_KEY (GitHub App do repositório
 * original), que este fork não tem — ver o cabeçalho de `release.yml`. Sem o
 * job, não há bash nenhum para extrair e rodar aqui.
 *
 * A doutrina inteira (identidade por PR de origem, não por `%an` do commit;
 * as duas provas — bot do App, ou head `release/*` do repositório de cima)
 * continua correta e documentada no histórico do upstream. Se este fork um
 * dia criar o GitHub App e trouxer `cortar-tag` de volta (ver o cabeçalho de
 * `release.yml`), este arquivo de teste volta junto, de lá.
 */
describe.skip("a guarda confere IDENTIDADE pelo PR de origem, não pelo nome do autor (job removido deste fork)", () => {
  it("ver o cabeçalho deste arquivo — job release.yml::cortar-tag não existe neste fork", () => {});
});
