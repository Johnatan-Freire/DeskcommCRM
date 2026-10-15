/**
 * AS TELAS NOVAS DA AUDITORIA DE AGENTES, PELA TELA (PR #19).
 *
 * Avisos temporários, feriados do atendimento, fila de pré-matrículas e as
 * chaves gerais de pausa — dirigidas como quem administra a escola faria, no
 * banco fresco do baseline. Nenhuma delas manda mensagem: as pausas só gravam
 * estado, e nada aqui liga agente ou follow-up.
 *
 * Seletores por `data-testid` (a redação muda com o idioma); evidência visual
 * por screenshot de cada tela.
 */
import { expect, test } from "./helpers/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

test.describe.configure({ timeout: 240_000, mode: "serial" });

test.describe("Agentes da escola — telas novas", () => {
  test.beforeEach(async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
  });

  test("avisos temporários: criar e publicar, ver no ar, arquivar", async ({ page }) => {
    await page.goto("/app/ai/avisos");
    await expect(page.getByTestId("avisos-temporarios")).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("novo-aviso").click();
    const form = page.getByTestId("formulario-aviso");
    await form.locator("#aviso-titulo").fill("Matrícula de outubro com 10% de desconto");
    await form.locator("#aviso-descricao").fill("10% de desconto na matrícula do curso de Excel até o fim do mês.");
    await form.locator("#aviso-cursos").fill("Excel");
    await page.getByTestId("publicar-aviso").click();

    const aviso = page.getByTestId("aviso").filter({ hasText: "Matrícula de outubro com 10% de desconto" });
    await expect(aviso).toBeVisible({ timeout: 30_000 });
    // O formulário nasce com início = agora e fim = +7 dias: publicado, está no ar.
    await expect(aviso.getByTestId("situacao-do-aviso")).toHaveText(/No ar|En vigor/);
    await page.screenshot({ path: "test-results/evidencia-avisos-temporarios.png", fullPage: true });

    await aviso.getByTestId("arquivar-aviso").click();
    await expect(aviso.getByTestId("situacao-do-aviso")).toHaveText(/Arquivado|Archivado/, { timeout: 30_000 });
  });

  test("feriados do atendimento: importar os nacionais e remover um", async ({ page }) => {
    await page.goto("/app/team");
    await page.getByRole("tab", { name: /atendimento|atención|attendance/i }).click();
    const secao = page.getByTestId("feriados-do-atendimento");
    await expect(secao).toBeVisible({ timeout: 60_000 });

    const ano = new Date().getFullYear() + 1;
    await page.getByTestId(`feriados-nacionais-${ano}`).click();
    await expect(secao.getByTestId("feriado").filter({ hasText: "Natal" })).toBeVisible({ timeout: 30_000 });
    // Feriado nacional por lei NÃO traz Carnaval (ponto facultativo, botão próprio).
    await expect(secao.getByTestId("feriado").filter({ hasText: "Carnaval" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/evidencia-feriados.png", fullPage: true });

    const natal = secao.getByTestId("feriado").filter({ hasText: "Natal" }).first();
    await natal.getByRole("button").click();
    await expect(secao.getByTestId("feriado").filter({ hasText: `25/12/${ano}` })).toHaveCount(0, { timeout: 30_000 });
  });

  test("fila de pré-matrículas: abre vazia e alterna para 'todas'", async ({ page }) => {
    await page.goto("/app/pre-matriculas");
    await expect(page.getByTestId("pre-matriculas")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("sem-pre-matriculas")).toBeVisible();
    await page.getByRole("link", { name: /Todas/ }).click();
    await expect(page).toHaveURL(/status=todas/);
    await expect(page.getByTestId("sem-pre-matriculas")).toBeVisible();
    await page.screenshot({ path: "test-results/evidencia-pre-matriculas.png", fullPage: true });
  });

  test("agentes: as chaves de pausa geral aparecem para o admin", async ({ page }) => {
    await page.goto("/app/ai/agents");
    const chaves = page.getByTestId("pausa-geral-dos-agentes");
    await expect(chaves).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("pausar-todos-os-agentes")).toBeVisible();
    await expect(page.getByTestId("retomar-todos-os-agentes")).toBeVisible();
    await page.screenshot({ path: "test-results/evidencia-pausa-agentes.png", fullPage: true });
  });

  test("follow-ups: pausar todos mostra a faixa para a equipe; retomar tira", async ({ page }) => {
    await page.goto("/app/ai/followups");
    await expect(page.getByTestId("pausa-geral-dos-followups")).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("pausar-todos-os-followups").click();
    await page.getByTestId("confirmar-pausa-dos-followups").click();
    await expect(page.getByTestId("faixa-followups-pausados")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "test-results/evidencia-followups-pausados.png", fullPage: true });

    // A pausa persiste: recarregar não a perde.
    await page.reload();
    await expect(page.getByTestId("faixa-followups-pausados")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("retomar-todos-os-followups").click();
    await page.getByTestId("confirmar-pausa-dos-followups").click();
    await expect(page.getByTestId("faixa-followups-pausados")).toHaveCount(0, { timeout: 30_000 });
  });
});
