import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Item 9 (Fase 3) — proteção contra testar um prompt e usar outro depois.
 *
 * `scripts/eval-agente-comercial-capital-code.ts` carrega o system prompt via
 * `readFileSync(join(__dirname, "eval-fixtures/capital-code-comercial-v2.4-prompt.md"))`
 * — este teste lê o MESMO arquivo, pelo MESMO caminho relativo, e prova duas
 * coisas: (1) as regras vigentes (pós-correção 0.1/0.2/0.3) estão presentes;
 * (2) nenhuma regra antiga/revogada sobrou. Se alguém editar o fixture com uma
 * regra velha, ou trocar o caminho que o eval script lê sem atualizar aqui,
 * este teste pega — é o gate que evita "testei um prompt, uso outro depois".
 */
const CAMINHO_DO_FIXTURE = join(__dirname, "capital-code-comercial-v2.4-prompt.md");
const PROMPT = readFileSync(CAMINHO_DO_FIXTURE, "utf8");

describe("fixture do prompt V2.4 — regras vigentes presentes", () => {
  it.each([
    ["hierarquia de fontes explícita", /hierarquia de fontes/i],
    ["proibição de marcar won", /não tem autorização para marcar.*won/i],
    ["exigência de reason real em lost", /reason.*real|motivo real/i],
    ["categorias catálogo vs disponibilidade separadas", /duas categorias de dado/i],
    ["proibição de prometer link de matrícula", /prometer link de matrícula/i],
    ["tool de catálogo com query/tipo", /consultar_catalogo_cursos\(\{query\?, tipo\?\}\)/],
    ["regra de modalidade_status inconsistente", /modalidade_status.*inconsistente/i],
    ["regra comercial presencial+EAD (não 100% online)", /presenciais e ead/i],
  ])("contém: %s", (_nome, padrao) => {
    expect(PROMPT).toMatch(padrao);
  });
});

describe("fixture do prompt V2.4 — regras revogadas NÃO presentes", () => {
  it.each([
    ["100% online (regra institucional antiga, incorreta)", /100% online/i],
    ["fallback antigo pra search_knowledge quando a tool falha", /sem resultado ou dado desatualizado.*caia para search_knowledge/i],
    ["promessa de link de matrícula", /consigo te mandar o link|te mando o link de matrícula agora/i],
    ["proibição antiga de falar preço antes de qualificar (UX rígida revogada)", /nunca informe o preço de cara/i],
    ["preço hardcoded antigo (R$980/7x R$140)", /r\$\s?980|7x de r\$\s?140/i],
  ])("NÃO contém: %s", (_nome, padrao) => {
    expect(PROMPT).not.toMatch(padrao);
  });
});
