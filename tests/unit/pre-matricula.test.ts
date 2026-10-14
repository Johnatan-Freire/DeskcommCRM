/**
 * Pré-matrícula (0659) — a validação do que o MODELO manda e o gate da ferramenta.
 * O banco (idempotência, acesso, LGPD) está em tests/invariants/pre-matriculas.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mensagemAposRegistro, normalizarTelefone, validarPreMatricula } from "@/lib/pre-matricula/registrar";

const OK = {
  nome_completo: "Joana Ficticia Souza",
  email: "Joana@Exemplo.com",
  curso: "Excel Avançado",
  turno: "noite",
  consentimento: true,
};

describe("validarPreMatricula", () => {
  it("dados mínimos + consentimento: passa, e-mail normalizado, telefone da conversa", () => {
    const r = validarPreMatricula(OK, "+55 (61) 99999-0000");
    expect(r).toEqual({ ok: true, dados: { ...OK, email: "joana@exemplo.com", telefone: "5561999990000" } });
  });

  it("⭐ sem consentimento (ausente ou false) não registra — e ensina a perguntar", () => {
    for (const consentimento of [undefined, false]) {
      const r = validarPreMatricula({ ...OK, consentimento }, "5561999990000");
      expect(r).toMatchObject({ ok: false, erro: { code: "sem_consentimento" } });
    }
  });

  it("nome sem sobrenome é recusado", () => {
    expect(validarPreMatricula({ ...OK, nome_completo: "Joana" }, "5561999990000")).toMatchObject({
      ok: false,
      erro: { code: "nome_incompleto" },
    });
  });

  it("e-mail inválido e turno fora da lista são recusados", () => {
    expect(validarPreMatricula({ ...OK, email: "joana" }, "5561999990000").ok).toBe(false);
    expect(validarPreMatricula({ ...OK, turno: "madrugada" }, "5561999990000").ok).toBe(false);
  });

  it("⭐ campo fora do contrato é recusado — CPF e documento não entram nem por engano", () => {
    expect(validarPreMatricula({ ...OK, cpf: "52998224725" }, "5561999990000")).toMatchObject({
      ok: false,
      erro: { code: "invalid_payload" },
    });
    expect(validarPreMatricula({ ...OK, organization_id: "x" }, "5561999990000").ok).toBe(false);
  });

  it("outro telefone informado vence o da conversa; sem DDD nenhum dos dois, recusa", () => {
    const r = validarPreMatricula({ ...OK, telefone_contato: "(11) 98888-7777" }, "5561999990000");
    expect(r).toMatchObject({ ok: true, dados: { telefone: "5511988887777" } });
    expect(validarPreMatricula(OK, null)).toMatchObject({ ok: false, erro: { code: "telefone_invalido" } });
  });
});

describe("normalizarTelefone", () => {
  it.each([
    ["(61) 99999-0000", "5561999990000"],
    ["61 3333-4444", "556133334444"],
    ["+55 61 99999-0000", "5561999990000"],
    ["99999-0000", null],
    ["", null],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarTelefone(entrada)).toBe(esperado);
  });
});

describe("o que volta ao modelo", () => {
  it("nunca deixa a IA dizer que a matrícula, a vaga ou o pagamento estão confirmados", () => {
    for (const s of ["registrada", "ja_existia"] as const) {
      expect(mensagemAposRegistro(s)).toMatch(/NÃO diga que a matrícula está feita, que a vaga está garantida nem que o pagamento foi confirmado/);
    }
  });
});

describe("o turno", () => {
  const fonte = readFileSync("lib/agent-engine/agent/inbound-turn.ts", "utf8");

  it("só oferece a ferramenta ao agente COMERCIAL de organização com a integração escolar", () => {
    expect(fonte).toMatch(
      /if \(sistemaEscolarConfig === null \|\| agentConfig === null \|\| agentConfig\.serviceScope !== 'comercial'\) \{\s*delete rawTools\.registrar_pre_matricula;/,
    );
  });

  it("registrou → passa a conversa para a equipe antes de responder", () => {
    const ini = fonte.indexOf("registrar_pre_matricula: tool({");
    const exec = fonte.slice(ini, fonte.indexOf("request_human_handoff: tool({", ini));
    expect(exec.indexOf("passarParaAEquipePeloSistema(")).toBeGreaterThan(exec.indexOf("registrarPreMatricula("));
    expect(exec).toContain("contactId: leadId");
  });
});
