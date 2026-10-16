/**
 * BUSCA POR TELEFONE PELO COMEÇO DO NÚMERO (pedido do atendimento, 16/10/2026).
 *
 * Digitar `61986` tem de filtrar os contatos cujo número COMEÇA assim. A regra
 * antiga (`*61986*`) casava a sequência em qualquer posição — com a base da
 * escola quase toda em `+55619…`, o resultado vinha misturado.
 *
 * Os padrões são medidos contra números E.164 de verdade com o mesmo `ilike`
 * que o PostgREST aplica (`*` = qualquer sequência, sem diferenciar caixa).
 */
import { describe, expect, it } from "vitest";

import { padroesDoTelefone } from "@/lib/inbox/termo-de-busca";

/** `phone_number ilike <padrão>` do PostgREST, em memória. */
function casa(padrao: string, telefone: string): boolean {
  const re = new RegExp(
    "^" + padrao.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
  return re.test(telefone);
}
const acha = (digitado: string, telefone: string) =>
  padroesDoTelefone(digitado).some((p) => casa(p, telefone));

const EXEMPLO = "+5561986531450";
const NO_MEIO = "+5511961986123"; // tem "61986" no meio, mas começa com 11

describe("padroesDoTelefone", () => {
  it("⭐ o começo do número acha (DDD + início), e o número que só tem os dígitos no meio não", () => {
    expect(acha("61986", EXEMPLO)).toBe(true);
    expect(acha("61986", NO_MEIO), "casou pela sequência no meio do número").toBe(false);
  });

  it("vale a cada dígito a mais, como quem digita", () => {
    for (const parcial of ["6198", "61986", "619865", "6198653", "61986531", "61986531450"]) {
      expect(acha(parcial, EXEMPLO), parcial).toBe(true);
    }
    expect(acha("61987", EXEMPLO)).toBe(false);
  });

  it("com o 55, com +, com máscara ou com zero de longa distância: o mesmo número", () => {
    for (const grafia of ["5561986", "+55 61 986", "(61) 98653", "061986", "+55 (61) 98653-1450"]) {
      expect(acha(grafia, EXEMPLO), grafia).toBe(true);
    }
  });

  it("número sem DDD (8+ dígitos) ainda acha — em qualquer posição", () => {
    expect(acha("98653-1450", EXEMPLO)).toBe(true);
    expect(acha("986531450", EXEMPLO)).toBe(true);
  });

  it("menos de 4 dígitos não vira busca de telefone", () => {
    expect(padroesDoTelefone("619")).toEqual([]);
    expect(padroesDoTelefone("Maria")).toEqual([]);
  });
});
