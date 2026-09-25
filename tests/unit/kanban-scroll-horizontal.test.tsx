import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useBoardScroll } from "@/components/kanban/KanbanBoard";

/**
 * Porte do fork (df5e06c85 + e6818af39): as colunas de estágio rolam na
 * horizontal sem nenhum indício visual, e quem tem mais estágios do que cabem
 * na tela não descobre sozinho. `useBoardScroll` é a lógica isolada por trás
 * das setas — testada aqui sem montar o KanbanBoard inteiro (que puxa
 * useBoard/useMoveCard/useAssignableMembers/useAtRiskLeads/useReactivations,
 * todos hooks de react-query com fetch real) porque a única coisa nova é esta
 * detecção de overflow, não o board em si.
 */
function Harness() {
  const { ref, canScrollLeft, canScrollRight, scrollBy } = useBoardScroll();
  return (
    <div>
      <div ref={ref} data-testid="scroller">
        conteúdo
      </div>
      <span data-testid="left">{String(canScrollLeft)}</span>
      <span data-testid="right">{String(canScrollRight)}</span>
      <button onClick={() => scrollBy(320)}>rolar</button>
    </div>
  );
}

function setScrollMetrics(
  el: HTMLElement,
  { scrollLeft = 0, clientWidth = 800, scrollWidth = 800 }: Partial<Record<"scrollLeft" | "clientWidth" | "scrollWidth", number>>,
) {
  Object.defineProperty(el, "scrollLeft", { value: scrollLeft, configurable: true, writable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
}

describe("useBoardScroll — setas de scroll horizontal do kanban", () => {
  it("sem overflow (conteúdo cabe na tela): nenhuma seta aparece", () => {
    render(<Harness />);
    const el = screen.getByTestId("scroller");
    act(() => {
      setScrollMetrics(el, { scrollLeft: 0, clientWidth: 800, scrollWidth: 800 });
      fireEvent.scroll(el);
    });
    expect(screen.getByTestId("left")).toHaveTextContent("false");
    expect(screen.getByTestId("right")).toHaveTextContent("false");
  });

  it("com overflow, no início: só a seta direita aparece", () => {
    render(<Harness />);
    const el = screen.getByTestId("scroller");
    act(() => {
      setScrollMetrics(el, { scrollLeft: 0, clientWidth: 800, scrollWidth: 2000 });
      fireEvent.scroll(el);
    });
    expect(screen.getByTestId("left")).toHaveTextContent("false");
    expect(screen.getByTestId("right")).toHaveTextContent("true");
  });

  it("com overflow, no meio: as duas setas aparecem", () => {
    render(<Harness />);
    const el = screen.getByTestId("scroller");
    act(() => {
      setScrollMetrics(el, { scrollLeft: 500, clientWidth: 800, scrollWidth: 2000 });
      fireEvent.scroll(el);
    });
    expect(screen.getByTestId("left")).toHaveTextContent("true");
    expect(screen.getByTestId("right")).toHaveTextContent("true");
  });

  it("com overflow, no fim: só a seta esquerda aparece", () => {
    render(<Harness />);
    const el = screen.getByTestId("scroller");
    act(() => {
      setScrollMetrics(el, { scrollLeft: 1200, clientWidth: 800, scrollWidth: 2000 });
      fireEvent.scroll(el);
    });
    expect(screen.getByTestId("left")).toHaveTextContent("true");
    expect(screen.getByTestId("right")).toHaveTextContent("false");
  });

  it("scrollBy aciona o scroll nativo do elemento com o delta pedido", () => {
    render(<Harness />);
    const el = screen.getByTestId("scroller");
    const nativeScrollBy = vi.fn();
    el.scrollBy = nativeScrollBy;
    fireEvent.click(screen.getByText("rolar"));
    expect(nativeScrollBy).toHaveBeenCalledWith({ left: 320, behavior: "smooth" });
  });
});
