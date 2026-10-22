import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/types/messaging";

/**
 * A MENSAGEM NOVA APARECE — mesmo numa conversa com 50 ou mais.
 *
 * Relato: "a mensagem demora vários segundos para chegar no inbox". Medido em
 * produção em 20/10/2026: a ingestão leva ~1,2s e o tempo real entrega em
 * 0,3–1s. Quem atrasava era o FIO. A conversa carrega as 50 mais recentes e o
 * tempo real recarrega essa mesma página: a nova entra no fim, a mais antiga
 * sai do começo e `items.length` continua 50 — o efeito de rolagem, que só
 * dependia do tamanho, nem rodava. A mensagem ficava escondida abaixo da dobra
 * (73 → 138 → 204px) até a guarda de 120px travar de vez.
 *
 * O segundo defeito é da guarda: ela media a distância ao fim DEPOIS de a
 * mensagem nova existir, então uma foto ou um texto longo (>120px sozinhos)
 * contavam como "o usuário está lendo o histórico".
 */

const estado = vi.hoisted(() => ({ mensagens: [] as unknown[] }));

vi.mock("@/hooks/inbox/useMessagesRealtime", () => ({
  useMessagesRealtime: () => ({
    data: { pages: [{ data: estado.mensagens }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/inbox/useConversationNotes", () => ({ useConversationNotes: () => [] }));
vi.mock("@/hooks/inbox/usePassagensDaConversa", () => ({ usePassagensDaConversa: () => [] }));
vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useDeleteNote", () => ({ useDeleteNote: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/ai/useDebugToggle", () => ({ useDebugToggle: () => ({ enabled: false }) }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ role: "agent" }),
  useUser: () => ({ id: "u-1" }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useLocaleDeData: () => undefined }));
vi.mock("@/components/inbox/MessageBubble", () => ({ MessageBubble: () => <div /> }));
vi.mock("@/components/inbox/NoteCard", () => ({ NoteCard: () => null }));
vi.mock("@/components/inbox/PassagemCard", () => ({ PassagemCard: () => null }));

import { ChatThread } from "@/components/inbox/ChatThread";

function mensagem(n: number, extra: Partial<Message> = {}): Message {
  return {
    id: `m-${n}`,
    direction: "inbound",
    sent_by_user_id: null,
    sent_at: new Date(Date.UTC(2026, 9, 20, 12, 0, n)).toISOString(),
    reply_to_message_id: null,
    ...extra,
  } as unknown as Message;
}

/** A página que o servidor devolve: as 50 mais recentes até `ultima`. */
function janela(ultima: number): Message[] {
  return Array.from({ length: 50 }, (_, i) => mensagem(ultima - 49 + i));
}

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

/** jsdom não faz layout: a geometria do fio é controlada pelo teste. */
const geo = { scrollHeight: 2000, scrollTop: 1280, clientHeight: 720 };
const originais = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
};

const rolar = vi.fn();
const original = Element.prototype.scrollIntoView;

function scroller(): HTMLElement {
  const el = screen.getByTestId("thread-scroller-sonda").parentElement;
  if (!el) throw new Error("fio não montado");
  return el;
}

/** A pessoa sobe para ler o histórico. */
function subirParaOHistorico() {
  const sc = scroller();
  geo.scrollTop = 1280;
  fireEvent.scroll(sc);
  geo.scrollTop = 400;
  fireEvent.scroll(sc);
}

describe("ChatThread: mensagem nova no fim do fio", () => {
  beforeEach(() => {
    qc = new QueryClient();
    rolar.mockClear();
    Object.assign(geo, { scrollHeight: 2000, scrollTop: 1280, clientHeight: 720 });
    for (const p of Object.keys(geo) as (keyof typeof geo)[]) {
      Object.defineProperty(HTMLElement.prototype, p, {
        configurable: true,
        get: () => geo[p],
        set: () => {},
      });
    }
    Element.prototype.scrollIntoView = rolar;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
    for (const [p, d] of Object.entries(originais)) {
      if (d) Object.defineProperty(HTMLElement.prototype, p, d);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p];
    }
  });

  function abrir(mensagens: Message[]) {
    estado.mensagens = mensagens;
    const r = render(<ChatThread conversationId="c-1" />, { wrapper });
    // Sonda para achar o scroller sem depender de classe CSS.
    r.container.querySelector(".overflow-y-auto")?.insertAdjacentHTML(
      "afterbegin",
      '<span data-testid="thread-scroller-sonda"></span>',
    );
    rolar.mockClear();
    return r;
  }

  it("conversa com 50+: a 51ª entra e a 1ª sai, e o fio ROLA mesmo com o tamanho igual", () => {
    const { rerender } = abrir(janela(50));
    estado.mensagens = janela(51);
    rerender(<ChatThread conversationId="c-1" />);
    expect(rolar.mock.calls.map((c) => (c[0] as ScrollIntoViewOptions).behavior)).toEqual(["smooth"]);
  });

  it("mensagem alta (foto, texto longo) com a pessoa no fim: rola mesmo passando de 120px", () => {
    const { rerender } = abrir(janela(50));
    // A nova já está desenhada quando o efeito mede: 400px abaixo da dobra.
    geo.scrollHeight = 2400;
    estado.mensagens = janela(51);
    rerender(<ChatThread conversationId="c-1" />);
    expect(rolar).toHaveBeenCalledTimes(1);
  });

  it("quem está lendo o histórico NÃO é arrancado, e vê o aviso 'Nova mensagem'", () => {
    const { rerender } = abrir(janela(50));
    subirParaOHistorico();
    estado.mensagens = janela(51);
    rerender(<ChatThread conversationId="c-1" />);
    expect(rolar).not.toHaveBeenCalled();

    const aviso = screen.getByTestId("thread-nova-mensagem");
    act(() => aviso.click());
    expect(rolar).toHaveBeenCalledWith({ behavior: "smooth", block: "end" });
    expect(screen.queryByTestId("thread-nova-mensagem")).toBeNull();
  });

  it("a mensagem que EU envio leva ao fim mesmo lendo o histórico", () => {
    const { rerender } = abrir(janela(50));
    subirParaOHistorico();
    estado.mensagens = [
      ...janela(50).slice(1),
      mensagem(51, { direction: "outbound", sent_by_user_id: "u-1" } as Partial<Message>),
    ];
    rerender(<ChatThread conversationId="c-1" />);
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("thread-nova-mensagem")).toBeNull();
  });

  it("o último item SAIR (apagado) não é 'mensagem nova'", () => {
    const { rerender } = abrir(janela(51));
    subirParaOHistorico();
    estado.mensagens = janela(51).slice(0, -1);
    rerender(<ChatThread conversationId="c-1" />);
    expect(screen.queryByTestId("thread-nova-mensagem")).toBeNull();
  });

  it("voltar ao fim rolando apaga o aviso", () => {
    const { rerender } = abrir(janela(50));
    subirParaOHistorico();
    estado.mensagens = janela(51);
    rerender(<ChatThread conversationId="c-1" />);
    expect(screen.getByTestId("thread-nova-mensagem")).toBeTruthy();
    geo.scrollTop = 1280;
    fireEvent.scroll(scroller());
    expect(screen.queryByTestId("thread-nova-mensagem")).toBeNull();
  });
});
