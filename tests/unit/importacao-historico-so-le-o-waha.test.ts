/**
 * A importação do histórico do WhatsApp é INCAPAZ de enviar — e isto é medido
 * no grafo de imports, não no nome dos arquivos.
 *
 * A partir de todo arquivo da importação (lib/whatsapp-historico, o cron e as
 * rotas da tela), percorre os imports TRANSITIVOS de runtime e reprova se algum
 * caminho alcançar um módulo capaz de mandar mensagem ou de acordar quem manda:
 * o cliente do WAHA, o envio, o motor do agente, os workers, follow-up,
 * automação, campanha, prospecção, rodízio.
 *
 * `import type` não entra: não leva código para o runtime.
 *
 * E o leitor do WAHA, o único que fala com a rede, é lido no texto: só GET, e
 * só os dois caminhos de leitura.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { describe, expect, it } from "vitest";

import { caminhoPermitido } from "@/lib/whatsapp-historico/leitor-waha";

const IMPORT =
  /(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolver(origem: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = normalize(join(dirname(origem), spec));
  else return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Caminho de imports do `de` até cada arquivo alcançado — para a falha dizer POR ONDE. */
function grafo(entradas: string[]): Map<string, string[]> {
  const via = new Map<string, string[]>();
  const pilha = entradas.map((e) => [e] as string[]);
  while (pilha.length) {
    const caminho = pilha.pop()!;
    const arquivo = caminho[caminho.length - 1]!;
    if (via.has(arquivo)) continue;
    via.set(arquivo, caminho);
    const src = readFileSync(arquivo, "utf8");
    for (const m of src.matchAll(IMPORT)) {
      if (m[1]) continue; // import/export type
      const destino = resolver(arquivo, (m[2] ?? m[3])!);
      if (destino) pilha.push([...caminho, destino]);
    }
  }
  return via;
}

function arquivosDe(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && statSync(f).isFile());
}

const ENTRADAS = [
  ...arquivosDe("lib/whatsapp-historico"),
  ...arquivosDe("app/api/v1/cron/whatsapp-history-import"),
  ...arquivosDe("app/api/v1/channel-sessions/[id]/history-imports"),
];

/** Quem envia mensagem ou acorda quem envia. */
const PROIBIDOS: readonly RegExp[] = [
  /^lib\/waha\/(client|send|media-send|ingest)\.ts$/,
  /^lib\/channels\/(send|envio|enviar|pos-entrada|connect-waha)/,
  /^lib\/agent-engine\//,
  /^workers\//,
  /^lib\/followup\//,
  /^lib\/automation\//,
  /^lib\/campanhas?\//,
  /^lib\/campaigns?\//,
  /^lib\/prospec/,
  /^lib\/routing\//,
  /^lib\/ai\/dispatcher\//,
  /(^|\/)(outbound|envio|disparo)[^/]*\.ts$/,
];

describe("a importação do histórico só LÊ o WAHA", () => {
  it("o instrumento enxerga o que diz enxergar (guarda de vacuidade)", () => {
    expect(ENTRADAS).toContain("lib/whatsapp-historico/leitor-waha.ts");
    expect(ENTRADAS).toContain("lib/whatsapp-historico/importador.ts");
    expect(ENTRADAS).toContain("app/api/v1/cron/whatsapp-history-import/route.ts");
    // O grafo atravessa de fato: chega à leitura de payload e ao repositório.
    const alcancados = [...grafo(ENTRADAS).keys()];
    expect(alcancados).toContain("lib/waha/payload.ts");
    expect(alcancados).toContain("lib/whatsapp-historico/repositorio.ts");
    // E o detector reconhece um módulo que envia quando o vê.
    expect(PROIBIDOS.some((r) => r.test("lib/waha/client.ts"))).toBe(true);
  });

  it("nenhum import transitivo alcança módulo que envia ou acorda quem envia", () => {
    const via = grafo(ENTRADAS);
    const violacoes = [...via.entries()]
      .filter(([arquivo]) => PROIBIDOS.some((r) => r.test(arquivo)))
      .map(([, caminho]) => caminho.join("  →  "));
    expect(violacoes, "a importação do histórico alcança código que envia").toEqual([]);
  });

  it("a leitura de payload compartilhada com a ingestão ao vivo não importa nada de runtime", () => {
    // `lib/waha/payload.ts` é a régua comum; se ela importasse o cliente, todo o
    // resto desta cerca seria contornado por ela.
    const src = readFileSync("lib/waha/payload.ts", "utf8");
    const runtime = [...src.matchAll(IMPORT)].filter((m) => !m[1]).map((m) => m[2] ?? m[3]);
    expect(runtime).toEqual([]);
  });

  it("o leitor do WAHA só faz GET, e só nos dois caminhos de leitura", () => {
    const src = readFileSync("lib/whatsapp-historico/leitor-waha.ts", "utf8");
    const metodos = [...src.matchAll(/method:\s*["']([A-Z]+)["']/g)].map((m) => m[1]);
    expect(metodos).toEqual(["GET"]);
    expect(src).not.toMatch(/body:\s*JSON\.stringify/);
    expect(src).not.toMatch(/send(Text|Image|File|Voice|Video|Seen)|forward|\/reply/i);

    expect(caminhoPermitido("/api/org_x/chats")).toBe(true);
    expect(caminhoPermitido("/api/org_x/chats/5511999999999%40c.us/messages")).toBe(true);
    for (const envio of [
      "/api/sendText",
      "/api/sendImage",
      "/api/sendSeen",
      "/api/org_x/chats/5511%40c.us/messages/abc/forward",
      "/api/sessions/org_x/start",
      "/api/sessions/org_x",
      "/api/org_x/chats/5511%40c.us",
    ]) {
      expect(caminhoPermitido(envio), envio).toBe(false);
    }
  });
});
