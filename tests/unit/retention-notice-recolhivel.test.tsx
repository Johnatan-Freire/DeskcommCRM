import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O AVISO DE RESPOSTA SEGURADA NÃO TOMA A CONVERSA.
 *
 * Aberto, o aviso de aquecimento do número ocupava quatro linhas entre o fio e o
 * composer, em toda conversa com retenção nas últimas 24h. Agora ele nasce numa
 * linha, a explicação abre em "Ver detalhes", e o X fecha — até a PRÓXIMA
 * retenção, que tem de voltar a aparecer sozinha.
 */

const estado = vi.hoisted(() => ({ id: "r-1" }));

vi.mock("@/hooks/inbox/useRetention", () => ({
  useRetention: () => ({
    data: {
      retentions: [
        { id: estado.id, created_at: new Date().toISOString(), vetoed_gate: "pacing", vetoed_code: "warmup_cap" },
      ],
      context: { window_start_hour: 7, window_end_hour: 22, allow_sunday: true, timezone: "America/Sao_Paulo" },
    },
  }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useLocaleDeData: () => undefined }));

import { RetentionNotice } from "@/components/inbox/RetentionNotice";

const TITULO = "Resposta segurada pela proteção do número";

describe("RetentionNotice: compacto e com fechar", () => {
  beforeEach(() => {
    estado.id = "r-1";
    window.localStorage.clear();
  });
  afterEach(() => window.localStorage.clear());

  it("nasce numa linha: título à vista, explicação escondida", () => {
    render(<RetentionNotice conversationId="c-1" />);
    expect(screen.getByText(TITULO)).toBeTruthy();
    expect(screen.queryByText(/aquecimento/)).toBeNull();
  });

  it("'Ver detalhes' abre e fecha a explicação", () => {
    render(<RetentionNotice conversationId="c-1" />);
    fireEvent.click(screen.getByTestId("retention-notice-detalhes"));
    expect(screen.getByText(/aquecimento/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("retention-notice-detalhes"));
    expect(screen.queryByText(/aquecimento/)).toBeNull();
  });

  it("o X fecha o aviso, e ele continua fechado depois de recarregar a tela", () => {
    const { unmount } = render(<RetentionNotice conversationId="c-1" />);
    act(() => screen.getByTestId("retention-notice-fechar").click());
    expect(screen.queryByTestId("retention-notice")).toBeNull();
    unmount();
    render(<RetentionNotice conversationId="c-1" />);
    expect(screen.queryByTestId("retention-notice")).toBeNull();
  });

  it("uma retenção NOVA volta a aparecer depois de fechar a anterior", () => {
    const { rerender } = render(<RetentionNotice conversationId="c-1" />);
    act(() => screen.getByTestId("retention-notice-fechar").click());
    estado.id = "r-2";
    rerender(<RetentionNotice conversationId="c-1" />);
    expect(screen.getByTestId("retention-notice")).toBeTruthy();
  });

  it("fechar numa conversa não esconde o aviso de outra", () => {
    const { unmount } = render(<RetentionNotice conversationId="c-1" />);
    act(() => screen.getByTestId("retention-notice-fechar").click());
    unmount();
    render(<RetentionNotice conversationId="c-2" />);
    expect(screen.getByTestId("retention-notice")).toBeTruthy();
  });
});
