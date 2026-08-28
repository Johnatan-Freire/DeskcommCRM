import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

/**
 * O PAINEL DE MARCAR CABE NA TELA — medido por GEOMETRIA, não por presença.
 *
 * ═══ O defeito ═══════════════════════════════════════════════════════════════
 * O dono do produto abriu a v1.8.0 na VPS, escolheu o dia, e a coluna de
 * horários apareceu FORA do painel, cortada pela borda direita. "Nem zoom out,
 * nem scroll, nem alongar a janela resolve." Não dava para escolher horário
 * nenhum — que é a única coisa que este painel existe para fazer.
 *
 * É aritmética de largura, não responsividade:
 *
 *   contexto  280px  (lg:w-[280px])
 *   calendário 420px  (md:min-w-[420px])
 *   horários  280px  (lg:w-[280px], com md:shrink-0)
 *   ────────────────
 *   ≈ 980px   dentro de um Sheet de `sm:max-w-3xl` = 768px
 *
 * O painel tem `overflow-hidden`, então o excedente é cortado EM SILÊNCIO: sem
 * barra de rolagem, sem aviso, sem como alcançar o que sumiu.
 *
 * ═══ POR QUE ESTA SPEC EXISTE, e a crítica é justa ═══════════════════════════
 * Havia 20 casos Playwright sobre esta tela, e nenhum pegou. Todos assertam
 * PRESENÇA — `toBeVisible()`, `toHaveCount()` — e **elemento cortado continua
 * presente**: ele está no DOM, tem tamanho, e o Playwright o considera visível.
 * A borda que o corta é do PAI.
 *
 * Presença nunca vai medir isto. Só a geometria mede: onde a coluna TERMINA
 * contra onde o painel termina. É a diferença entre "o elemento existe" e "a
 * pessoa consegue usar".
 *
 * ═══ A RÉGUA CERTA, e eu escolhi a errada primeiro ═══════════════════════════
 * Minha primeira versão media "a coluna termina depois do painel". Ela ficou
 * VERMELHA, e eu quase tomei isso por prova. Medindo o estado ESTÁVEL (depois de
 * a animação de `width` terminar), os números são:
 *
 *   viewport   sheet         painel        coluna de horários
 *   1280       512..1280     537..1519     1238..1518
 *   1440       672..1440     697..1679     1398..1678
 *   1920      1152..1920    1177..2159     1878..2158
 *
 * A coluna termina em 1518 e o painel em 1519: **aquela asserção PASSA**. Ela só
 * falhava por medir no meio da transição de `width` — falso vermelho hoje, falso
 * VERDE amanhã, com o produto quebrado igual. Por isso esta spec espera a
 * largura ESTABILIZAR antes de medir.
 *
 * A régua certa é outra, e são duas:
 *   1. o PAINEL cabe no SHEET que o hospeda (982 contra 768 — transborda 214px);
 *   2. a coluna de horários cabe na VIEWPORT (só 42 dos 280px aparecem).
 *
 * ═══ E o defeito NÃO some em tela grande ═════════════════════════════════════
 * Era a previsão, e a medição a derruba: em 1920 o transbordo é idêntico, porque
 * o Sheet é fixo em 768px e ancorado à direita. As três larguras estão aqui não
 * para achar onde o defeito some, mas para provar que ele NÃO some — e para que
 * um conserto que só funcione numa delas seja reprovado nas outras.
 */
const RAIZ = path.resolve(__dirname, "../..");

test.describe.configure({ timeout: 180_000 });

interface Creds {
  password: string;
  users: Record<string, { email: string } | undefined>;
  agenda?: { tipo_nome: string };
}

function lerCreds(): Creds {
  const p = path.join(RAIZ, ".e2e-creds.json");
  if (!fs.existsSync(p)) throw new Error("`.e2e-creds.json` ausente — rode `scripts/seed-e2e-credentials.ts`");
  let c = JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
  if (!c.agenda) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-agenda.ts"], { stdio: "inherit", cwd: RAIZ });
    c = JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
  }
  return c;
}

async function entrar(page: Page, creds: Creds) {
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
}

/**
 * Abre o painel e escolhe um dia com horário livre — a coluna de horários só
 * existe depois disso (`data-aberta`), e é ela que transborda.
 */
async function abrirPainelComDiaEscolhido(page: Page, nomeDoTipo: string): Promise<void> {
  await page.goto("/app/agenda");
  await page.getByRole("button", { name: /Novo agendamento/i }).click();
  const painel = page.getByTestId("painel-de-marcacao");
  await expect(painel).toBeVisible({ timeout: 20_000 });

  // ESCOLHER O TIPO DO SEED, e não o primeiro da lista.
  //
  // `page.tsx` ordena os tipos por NOME e o painel abre no primeiro — que nesta
  // organização é "Atendimento", sem jornada publicada. Sem esta linha o painel
  // não oferece dia nenhum, a coluna de horários nunca abre, e a spec falha por
  // FALTA DE CENÁRIO em vez de por geometria: um vermelho que não prova nada
  // sobre o defeito, e que eu quase tomei como prova.
  await expect(page.getByTestId("tipos-de-agendamento")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: new RegExp(`^${nomeDoTipo}`) }).click();

  // O primeiro dia CLICÁVEL. `data-disponivel` é o que a tela usa para decidir
  // o clique, então usá-lo aqui mede o mesmo estado que o usuário enxerga.
  const dia = page.locator('[data-testid^="dia-"][data-disponivel="true"]').first();
  await expect(
    dia,
    "nenhum dia disponível — o seed da agenda não deixou jornada publicada, e sem " +
      "dia clicável a coluna de horários nunca abre (o defeito ficaria invisível)",
  ).toBeVisible({ timeout: 20_000 });
  await dia.click();

  const coluna = page.getByTestId("coluna-de-horarios");
  await expect(coluna).toHaveAttribute("data-aberta", "true", { timeout: 15_000 });

  // ⚠️ ESPERAR A LARGURA ESTABILIZAR, e isto não é paciência: a coluna abre com
  // uma transição de `width`, e medir no meio dela dá números que não são de
  // estado nenhum. Foi assim que a primeira versão desta spec ficou vermelha
  // pelo motivo errado — e teria ficado verde, com o produto igualmente
  // quebrado, no dia em que a máquina rodasse um pouco mais devagar.
  await expect(async () => {
    const a = (await coluna.boundingBox())?.width ?? 0;
    await page.waitForTimeout(120);
    const b = (await coluna.boundingBox())?.width ?? 0;
    expect(a, "a largura da coluna ainda está mudando").toBe(b);
    expect(b, "a coluna não chegou a abrir").toBeGreaterThan(0);
  }).toPass({ timeout: 10_000 });
}

for (const viewport of [
  // 900 é o EMPILHADO: abaixo de `lg` os horários viram seção sob o calendário.
  // Sem este caso, o conserto poderia quebrar as telas menores sem nada acusar.
  { name: "900×800 (empilhado)", width: 900, height: 800 },
  // 1024 é o LIMIAR, e o caso mais arriscado dos cinco: é onde as três colunas
  // (980px) passam a valer, dentro de um Sheet de 1024 — 44px de folga. Um
  // ajuste de padding em qualquer das colunas estoura aqui primeiro.
  { name: "1024×800 (limiar das 3 colunas)", width: 1024, height: 800 },
  { name: "1280×800 (notebook comum)", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  // 1920 está aqui para provar que o defeito NÃO some em tela grande — o Sheet
  // é fixo em 768px e ancorado à direita, então o transbordo é idêntico.
  { name: "1920×1080", width: 1920, height: 1080 },
]) {
  test(`a coluna de horários cabe DENTRO do painel — ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const creds = lerCreds();
    await entrar(page, creds);
    await abrirPainelComDiaEscolhido(page, creds.agenda!.tipo_nome);

    const painel = page.getByTestId("painel-de-marcacao");
    const horarios = page.getByTestId("coluna-de-horarios");
    const sheet = page.locator('[role="dialog"]').first();

    const cxSheet = await sheet.boundingBox();
    const cxPainel = await painel.boundingBox();
    const cxHorarios = await horarios.boundingBox();
    expect(cxSheet, "o Sheet não tem caixa — o painel não está dentro de um diálogo").not.toBeNull();
    expect(cxPainel, "o painel não tem caixa — ele não renderizou").not.toBeNull();
    expect(cxHorarios, "a coluna de horários não tem caixa").not.toBeNull();
    const sh = cxSheet as { x: number; width: number };
    const p = cxPainel as { x: number; width: number };
    const h = cxHorarios as { x: number; width: number };

    // ── RÉGUA 1: o painel cabe no CONTAINER que o hospeda ────────────────────
    // É a conta do defeito: 982px de painel dentro de um Sheet de 768px, com
    // `overflow-hidden` cortando os 214px de diferença EM SILÊNCIO.
    expect(
      p.x + p.width,
      `o painel termina em ${Math.round(p.x + p.width)}px e o Sheet que o hospeda em ` +
        `${Math.round(sh.x + sh.width)}px — ele transborda ${Math.round(p.x + p.width - sh.x - sh.width)}px. ` +
        "O `overflow-hidden` corta sem barra de rolagem: o que passa da borda fica inalcançável.",
    ).toBeLessThanOrEqual(sh.x + sh.width + 1);

    // ── RÉGUA 2: a coluna de horários está DENTRO DA TELA ────────────────────
    // O desfecho para quem usa. Medido no defeito: a coluna começava em 1238px
    // numa janela de 1280 — 42 dos 280px visíveis, o resto fora da tela.
    expect(
      h.x + h.width,
      `a coluna de horários vai até ${Math.round(h.x + h.width)}px, fora de uma janela de ` +
        `${viewport.width}px — só ${Math.round(Math.max(0, viewport.width - h.x))}px dela aparecem. ` +
        "É o que o dono do produto viu: a coluna cortada pela borda direita, sem como alcançá-la.",
    ).toBeLessThanOrEqual(viewport.width + 1);

    // ── RÉGUA 3: caber por não existir não é caber ───────────────────────────
    expect(
      h.width,
      `a coluna cabe mas ficou com ${Math.round(h.width)}px — espremida a ponto de não ` +
        "dar para ler nem clicar num horário",
    ).toBeGreaterThan(100);
  });
}

test("dá para CLICAR num horário — o teste final é a ação, não a medida", async ({ page }) => {
  // A geometria acima é o diagnóstico; isto é o desfecho. Um horário pode estar
  // dentro do painel e ainda assim ser inalcançável (coberto por outra camada,
  // com `pointer-events` bloqueado). O clique atravessa as duas hipóteses.
  await page.setViewportSize({ width: 1280, height: 800 });
  const creds = lerCreds();
  await entrar(page, creds);
  await abrirPainelComDiaEscolhido(page, creds.agenda!.tipo_nome);

  const horario = page.locator('[data-testid^="horario-"]').first();
  await expect(horario, "o dia foi escolhido e nenhum horário apareceu").toBeVisible({
    timeout: 15_000,
  });
  // `timeout` curto de propósito: se o botão estiver fora do alcance, quero a
  // falha rápida e com a mensagem certa, não 150s de espera.
  await horario.click({ timeout: 10_000 });

  await expect(
    page.getByTestId("confirmacao"),
    "cliquei no horário e o painel não avançou para a confirmação",
  ).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: "evidence/calendario/d1-painel-cabe-1280.png", fullPage: false });
});
