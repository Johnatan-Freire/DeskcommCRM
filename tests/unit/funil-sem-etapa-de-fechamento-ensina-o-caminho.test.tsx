/**
 * O ERRO "FUNIL SEM ETAPA DE FECHAMENTO" DIZ COMO RESOLVER (16/10/2026).
 *
 * Em produção, o funil padrão da escola não tinha etapa marcada como ganho e
 * "Marcar como ganho" respondia "Pipeline não tem stage de fechamento como
 * ganho." — inglês técnico e sem saída. A frase agora aponta a tela e a opção,
 * e este teste garante que os nomes citados EXISTEM na interface (uma frase
 * mandando procurar um rótulo que não existe é pior que nenhuma).
 */
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyPorFiltro } from "@/components/inbox/EmptyPorFiltro";

const encerramento = readFileSync("lib/leads/encerramento.ts", "utf8");
const etapas = readFileSync("app/app/settings/tenant/pipelines/_stages.tsx", "utf8");
const catalogo = readFileSync("lib/navigation/catalogo.ts", "utf8");

describe("mensagem do funil sem etapa de fechamento", () => {
  it("não fala mais 'Pipeline'/'stage' e aponta tela e opção", () => {
    expect(encerramento).not.toContain("stage de fechamento");
    expect(encerramento).toContain("Configurações › Etapas do funil");
    expect(encerramento).toContain("«Aqui o cliente fecha»");
    expect(encerramento).toContain("«Aqui o cliente desiste»");
  });

  it("os nomes citados existem na interface", () => {
    expect(catalogo).toContain('label: "Etapas do funil"');
    expect(etapas).toContain('papel: "O que acontece nesta coluna"');
    expect(etapas).toContain('won: "Aqui o cliente fecha"');
    expect(etapas).toContain('lost: "Aqui o cliente desiste"');
  });
});

describe("busca sem resultado na aba atual", () => {
  it("oferece repetir a busca em todas as conversas", () => {
    const buscar = vi.fn();
    render(<EmptyPorFiltro filtros={["Busca"]} onBuscarEmTodas={buscar} />);
    fireEvent.click(screen.getByTestId("buscar-em-todas"));
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("sem o callback (já em Todas, ou sem busca), o botão não aparece", () => {
    render(<EmptyPorFiltro filtros={["Busca"]} />);
    expect(screen.queryByTestId("buscar-em-todas")).not.toBeInTheDocument();
  });
});
