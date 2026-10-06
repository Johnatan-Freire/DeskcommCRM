import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { nomeDaSessaoCabeNoWaha } from "../../lib/channels/nome-da-sessao";
import { expect, test } from "./helpers/test";

/**
 * Importar o histórico do WhatsApp pela tela, como um admin faria: pede, vê o
 * recibo na fila, cancela.
 *
 * Banco e auth reais, sem interceptar a API da feature. Esta spec NÃO dispara o
 * cron e NÃO fala com WAHA nenhum: a leitura do histórico é provada contra um
 * WAHA simulado (lib/channels/historico/importador.test.ts) e o efeito no banco
 * pelo invariante de 10.000 mensagens. Aqui se prova a porta: quem pede, o que
 * a tela promete, e que o pedido sozinho não produz mensagem nem evento.
 */
test.use({ locale: "pt-BR" });

test("admin pede a importação do histórico, vê o recibo na fila e cancela", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Somente Supabase local");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const sufixo = randomUUID().slice(0, 8);
  const email = `historico-${sufixo}@example.test`;
  const senha = `E2e-${randomUUID()}!`;
  const orgNome = `historico-${sufixo}`;
  execFileSync("pnpm", ["exec", "tsx", "scripts/bootstrap-owner.ts"], {
    env: { ...process.env, OWNER_EMAIL: email, OWNER_PASSWORD: senha, OWNER_ORG_NAME: orgNome },
    stdio: "pipe",
  });
  const { data: org } = await admin.from("organizations").select("id").eq("slug", orgNome).single();
  const orgId = org!.id as string;
  await admin.from("organizations").update({ onboarded_at: new Date().toISOString() }).eq("id", orgId);

  // Número que já foi conectado um dia (é o que separa histórico de ao vivo).
  // STOPPED de propósito: nenhum cron de saúde vai procurá-lo no WAHA.
  const sessao = `hist_${sufixo}`;
  expect(nomeDaSessaoCabeNoWaha(sessao)).toBe(true);
  const primeiraConexao = "2026-09-21T19:41:34.000Z";
  const { data: canal, error } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: orgId,
      display_name: "Número com passado",
      waha_session_name: sessao,
      webhook_secret_encrypted: "\\x00",
      status: "STOPPED",
      first_connected_at: primeiraConexao,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  const canalId = canal!.id as string;
  const eventosAntes = (await admin.from("event_log").select("id", { count: "exact", head: true }).eq("organization_id", orgId)).count ?? 0;

  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/);
  await page.goto("/app/connections");
  await expect(page.getByText("Número com passado", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Importar histórico" }).click();
  const painel = page.getByRole("dialog", { name: "Importar o histórico do WhatsApp" });
  await expect(painel.getByText(/Nada é respondido nem enviado/)).toBeVisible();
  await expect(painel.getByText(/entram fechadas/)).toBeVisible();
  const dias = painel.getByLabel("Quantos dias antes da conexão do número");
  await expect(dias).toHaveValue("90");
  await dias.fill("30");
  await page.screenshot({ path: testInfo.outputPath("pedido.png"), fullPage: true });
  await painel.getByRole("button", { name: "Importar histórico" }).click();

  await expect(page.getByText("Histórico: na fila", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("na-fila.png"), fullPage: true });

  const { data: recibo } = await admin
    .from("whatsapp_history_imports")
    .select("id, organization_id, status, janela_inicio, janela_fim")
    .eq("channel_session_id", canalId)
    .single();
  expect(recibo!.organization_id).toBe(orgId);
  expect(recibo!.status).toBe("pendente");
  expect(new Date(recibo!.janela_fim as string).toISOString()).toBe(primeiraConexao);
  expect(new Date(recibo!.janela_inicio as string).toISOString()).toBe("2026-08-22T19:41:34.000Z");

  await page.getByRole("button", { name: "Cancelar importação" }).click();
  await expect(page.getByText("Histórico: importação cancelada", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cancelada.png"), fullPage: true });
  const { data: depois } = await admin.from("whatsapp_history_imports").select("status").eq("id", recibo!.id).single();
  expect(depois!.status).toBe("cancelada");

  // O pedido sozinho não produz mensagem nem evento de mensagem.
  const mensagens = (await admin.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId)).count ?? 0;
  expect(mensagens).toBe(0);
  const eventosDeMensagem = (
    await admin.from("event_log").select("id", { count: "exact", head: true }).eq("organization_id", orgId).like("event_type", "message.%")
  ).count ?? 0;
  expect(eventosDeMensagem).toBe(0);
  const eventosDepois = (await admin.from("event_log").select("id", { count: "exact", head: true }).eq("organization_id", orgId)).count ?? 0;
  expect(eventosDepois).toBe(eventosAntes);
});
