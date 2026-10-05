/**
 * `SENTRY_DSN=off` DESLIGA a telemetria — e desligar não é erro de configuração.
 *
 * O resolvedor (`resolveSentryDsn`) devolve `undefined` para `off`, e passávamos
 * isso direto ao `Sentry.init`. Só que o SDK do Node faz
 * `dsn: options.dsn ?? process.env.SENTRY_DSN` (@sentry/node-core,
 * `getClientOptions`): `undefined` cai no fallback, o SDK lê o `off` CRU do
 * ambiente, tenta interpretá-lo como DSN e imprime `Invalid Sentry Dsn: off` —
 * uma linha de "erro" a cada processo que sobe, numa instalação que fez
 * exatamente o que o kit recomenda (medido no log de produção em 2026-10-02).
 * A telemetria já ficava desligada; o defeito é o ruído.
 *
 * O teste usa o SDK REAL (`@sentry/nextjs`, entrada do servidor) e o controle
 * `dsn: undefined` reproduz a mensagem — a prova de que ele mede o que diz.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dsnParaOSdk, resolveSentryDsn } from "@/lib/sentry/dsn";

const original = process.env.SENTRY_DSN;
afterEach(async () => {
  if (original === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = original;
  vi.restoreAllMocks();
});

async function iniciaECaptura(dsn: string | undefined) {
  process.env.SENTRY_DSN = "off";
  const erros: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { erros.push(a.map(String).join(" ")); });
  // Cada caso com um SDK limpo: o Sentry guarda o estado em `globalThis.__SENTRY__`.
  vi.resetModules();
  delete (globalThis as { __SENTRY__?: unknown }).__SENTRY__;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({ dsn, tracesSampleRate: 0, defaultIntegrations: false });
  return { erros, Sentry };
}

describe("SENTRY_DSN=off", () => {
  it("o que vai ao SDK não é `undefined` (que dispara o fallback para o ambiente)", () => {
    expect(dsnParaOSdk(resolveSentryDsn("off"))).toBe("");
    expect(dsnParaOSdk(resolveSentryDsn("OFF"))).toBe("");
    expect(dsnParaOSdk(resolveSentryDsn("https://k@o.ingest.sentry.io/1"))).toBe("https://k@o.ingest.sentry.io/1");
  });

  it("com a DSN que o projeto entrega, o SDK real NÃO acusa `Invalid Sentry Dsn` e fica desligado", async () => {
    const { erros, Sentry } = await iniciaECaptura(dsnParaOSdk(resolveSentryDsn("off")));
    expect(erros.filter((e) => e.includes("Invalid Sentry Dsn"))).toEqual([]);
    expect(Sentry.getClient()?.getDsn()).toBeUndefined();
  });

  it("controle: `dsn: undefined` reproduz o ruído — é exatamente o defeito que este arquivo vigia", async () => {
    const { erros } = await iniciaECaptura(undefined);
    expect(erros.some((e) => e.includes("Invalid Sentry Dsn: off"))).toBe(true);
  });
});
