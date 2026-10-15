/**
 * O prompt do agente comercial da escola (lib/ai/agents/modelos-escola.ts) carrega
 * as regras de conduta pedidas na auditoria de agentes. Este arquivo fixa cada
 * uma, para que uma edição de texto não as tire sem alguém perceber.
 */
import { describe, expect, it } from "vitest";

import { PROMPT_COMERCIAL_ESCOLA } from "@/lib/ai/agents/modelos-escola";

describe("prompt comercial da escola", () => {
  it.each([
    ["não repete o que já foi respondido", /já disse .* não se pergunta de novo/s],
    ["segue o curso novo quando a pessoa muda de interesse", /mudou de curso de interesse, siga o novo/],
    ["descoberta consultiva (situação, problema, implicação, necessidade)", /situação dela hoje.*o que quer resolver.*o que acontece se não resolver.*o\s+que\s+mudaria/s],
    ["uma pergunta por vez, sem interrogatório", /no máximo uma pergunta por mensagem e sem interrogatório/],
    ["matrícula, pagamento e certificado só pelo que os materiais dizem", /matrícula, pagamento e certificado: responda só com o que/],
    ["objeção sem insistência", /respeite e\s+deixe a porta aberta, sem insistir/],
    ["sinais de intenção alta levam à pré-matrícula", /Sinais de que a pessoa quer se matricular.*ofereça a pré-matrícula/s],
    ["sem urgência falsa", /Nunca crie urgência que não existe/],
    ["sem CPF nem documento", /Nunca peça CPF, RG, endereço, foto ou documento/],
    ["não confirma matrícula, vaga nem pagamento", /Não diga que a matrícula está feita/],
    ["reconhece quando não sabe e não entra em loop", /Se você não souber responder.*Não dê\s+voltas repetindo/s],
  ])("%s", (_nome, regra) => {
    expect(PROMPT_COMERCIAL_ESCOLA).toMatch(regra);
  });
});
