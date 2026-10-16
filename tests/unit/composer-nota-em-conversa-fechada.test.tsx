/**
 * A NOTA INTERNA NÃO TRAVA ONDE SÓ A RESPOSTA DEVERIA TRAVAR (16/10/2026).
 *
 * Medido em produção: 216 das 224 conversas estavam fechadas e nenhuma aceitava
 * nota — o compositor usava a mesma trava da resposta (`disabled` = conversa
 * fechada, `blockedReason` = contato bloqueado) também no modo nota. A rota e a
 * RLS sempre aceitaram; a trava era só da tela.
 *
 * A nota nunca chega ao cliente: conversa fechada e contato bloqueado barram o
 * que SAI, não o registro interno. Anonimizado (LGPD) e suporte somente leitura
 * continuam barrando — `notaBloqueada`.
 */
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const createNoteMock = vi.fn();

vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useCreateNote", () => ({
  useCreateNote: () => ({ mutate: createNoteMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/inbox/useDraftReply", () => ({
  useDraftReply: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { Composer } from "@/components/inbox/Composer";

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>>) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Composer conversationId="conv-1" {...props} />
    </QueryClientProvider>,
  );
}

function escreverNota(texto: string) {
  fireEvent.click(screen.getByRole("button", { name: /nota interna/i }));
  fireEvent.change(screen.getByPlaceholderText(/nota interna/i), { target: { value: texto } });
  fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
}

describe("nota interna x travas da resposta", () => {
  beforeEach(() => {
    sendMock.mockClear();
    createNoteMock.mockClear();
  });

  it("⭐ conversa FECHADA: a nota é gravada", () => {
    renderComposer({ disabled: true, notaBloqueada: null });
    escreverNota("desistiu porque mudou de cidade");
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: "conv-1", body: "desistiu porque mudou de cidade" }),
      expect.anything(),
    );
  });

  it("⭐ contato BLOQUEADO: a nota é gravada, a resposta continua barrada", () => {
    renderComposer({ blockedReason: "Contato bloqueado — envio de mensagens desabilitado.", notaBloqueada: null });
    expect(screen.getByLabelText(/mensagem/i)).toBeDisabled();
    escreverNota("pediu para não receber mais mensagens");
    expect(createNoteMock).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("anonimizado / somente leitura: a nota continua barrada", () => {
    renderComposer({
      disabled: true,
      blockedReason: "Contato anonimizado — não é possível enviar mensagens.",
      notaBloqueada: "Contato anonimizado — não é possível enviar mensagens.",
    });
    // Nada para escrever: só o aviso, sem campo nem botão de nota.
    expect(screen.getByText(/anonimizado/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nota interna/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("sem `notaBloqueada` (quem não passa a regra nova): mantém a trava antiga", () => {
    renderComposer({ disabled: true });
    escreverNota("qualquer coisa");
    expect(createNoteMock).not.toHaveBeenCalled();
  });

  it("o Inbox passa a regra da nota sem a conversa fechada nem o bloqueio do contato", () => {
    const fonte = readFileSync("components/inbox/InboxLayout.tsx", "utf8");
    const ini = fonte.indexOf("notaBloqueada={");
    const bloco = fonte.slice(ini, fonte.indexOf("}\n", ini) + 1);
    expect(ini, "o Inbox não passa a regra da nota").toBeGreaterThan(-1);
    expect(bloco).toContain("is_anonymized");
    expect(bloco).not.toContain("closed");
    expect(bloco).not.toContain("is_blocked");
  });
});
