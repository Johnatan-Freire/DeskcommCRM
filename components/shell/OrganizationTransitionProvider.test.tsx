/**
 * Aba que estava recarregando quando outra aba trocou o acompanhamento de suporte.
 *
 * O aviso entre abas é o evento `storage`, e ele só chega a documento que já
 * registrou o listener. No e2e (run 37556998653), a `sameTab` começou a recarregar
 * ~400 ms antes de a aba principal gravar o aviso do `end()` e só rodou os efeitos
 * ~230 ms depois dele: perdeu o aviso e ficou na organização do suporte (#2471).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVISO, OrganizationTransitionProvider } from "./OrganizationTransitionProvider";

vi.mock("@/lib/supabase/browser", () => ({ resetRealtimeAuthentication: vi.fn() }));

const reload = vi.fn();
const original = window.location;
const DOCUMENTO_COMECOU_HA_MS = 5000;

beforeEach(() => {
  reload.mockReset();
  localStorage.clear();
  vi.spyOn(performance, "now").mockReturnValue(DOCUMENTO_COMECOU_HA_MS);
  // `window.location.reload` não é substituível direto no jsdom.
  Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: original });
});

const montar = () => render(<OrganizationTransitionProvider><p>Tela</p></OrganizationTransitionProvider>);

describe("aviso de troca de acompanhamento dado antes da hidratação", () => {
  it("aviso gravado depois de o documento começar: recarrega uma vez ao montar", () => {
    localStorage.setItem(AVISO, String(Date.now() - 1000));
    montar();
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByTestId("organization-transition").textContent).toBe("Atualizando acompanhamento…");
  });

  it("aviso anterior ao documento: ele já nasceu com o contexto novo e não recarrega", () => {
    localStorage.setItem(AVISO, String(Date.now() - DOCUMENTO_COMECOU_HA_MS - 1000));
    montar();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByTestId("organization-transition")).toBeNull();
  });

  it("sem aviso nenhum: não recarrega", () => {
    montar();
    expect(reload).not.toHaveBeenCalled();
  });

  it("armazenamento bloqueado: monta sem derrubar a tela e sem recarregar", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("bloqueado", "SecurityError"); });
    montar();
    expect(screen.getByText("Tela")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});
