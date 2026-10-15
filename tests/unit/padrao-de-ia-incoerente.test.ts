/**
 * O padrão de IA da organização incoerente (provedor de um lado, modelo de outro)
 * aparece na tela de Provedores. Caso medido em produção: openai + claude-sonnet-5.
 */
import { describe, expect, it } from "vitest";

import { padraoIncoerente } from "@/lib/ai/pontos/padrao-incoerente";

const CATALOGO = [
  { provider: "openai", model_id: "gpt-5.6-terra" },
  { provider: "openai", model_id: "gpt-5-mini" },
  { provider: "anthropic", model_id: "claude-sonnet-5" },
];

describe("padraoIncoerente", () => {
  it("⭐ o caso de produção: openai com modelo da Anthropic", () => {
    expect(padraoIncoerente({ provider: "openai", defaultModel: "claude-sonnet-5" }, CATALOGO)).toBe(true);
  });
  it("par coerente: sem aviso", () => {
    expect(padraoIncoerente({ provider: "openai", defaultModel: "gpt-5.6-terra" }, CATALOGO)).toBe(false);
  });
  it("sem catálogo do provedor (instalação nova): não acusa", () => {
    expect(padraoIncoerente({ provider: "openrouter", defaultModel: "qualquer" }, CATALOGO)).toBe(false);
  });
  it("sem modelo padrão: não acusa", () => {
    expect(padraoIncoerente({ provider: "openai", defaultModel: null }, CATALOGO)).toBe(false);
  });
});
