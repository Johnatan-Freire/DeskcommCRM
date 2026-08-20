import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ConversationHeader } from "@/components/inbox/ConversationHeader";

/**
 * F: antes só existia "Devolver ao automático" (o botão de VOLTA de um
 * handoff — da própria IA ou de force_human). Não havia jeito deliberado e
 * instantâneo de pausar pela tela: a única forma era digitar uma mensagem de
 * verdade (silêncio de 5min, deslizante) ou esperar a IA decidir sozinha.
 *
 * "Pausar automático" e "Devolver ao automático" são mutuamente exclusivos —
 * o primeiro aparece quando a IA está atendendo, o segundo quando já está
 * pausada (silenciada OU force_human). Nunca os dois ao mesmo tempo.
 */

const pausarMutate = vi.fn();
const retomarMutate = vi.fn();

vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useCloseConversation", () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useReleaseConversation", () => ({
  useReleaseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useResumeAiAttendance", () => ({
  useResumeAiAttendance: () => ({ mutate: retomarMutate, isPending: false }),
}));
vi.mock("@/hooks/inbox/usePauseAiAttendance", () => ({
  usePauseAiAttendance: () => ({ mutate: pausarMutate, isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1" }, activeOrg: { orgId: "org-1", role: "manager" } }),
}));

function baseConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "cv-1",
    organization_id: "org-1",
    contact_id: "ct-1",
    status: "open",
    assigned_to_user_id: null,
    assignee_kind: "ai",
    snooze_until: null,
    bot_silenced_until: null,
    tags: [],
    contacts: { id: "ct-1", display_name: "Fulana", name: null, phone_number: "5511999", force_human: false },
    ...overrides,
  } as unknown as React.ComponentProps<typeof ConversationHeader>["conversation"];
}

function renderHeader(conversation: React.ComponentProps<typeof ConversationHeader>["conversation"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConversationHeader conversation={conversation} />
    </QueryClientProvider>,
  );
}

describe("ConversationHeader — Pausar/Devolver automático são mutuamente exclusivos", () => {
  it("IA atendendo normalmente: mostra 'Pausar automático', não mostra 'Devolver ao automático'", () => {
    renderHeader(baseConversation());
    expect(screen.getByTestId("pausar-automatico")).toBeTruthy();
    expect(screen.queryByTestId("devolver-ao-automatico")).toBeNull();
  });

  it("já pausada por bot_silenced_until: mostra 'Devolver ao automático', não mostra 'Pausar automático'", () => {
    renderHeader(baseConversation({ bot_silenced_until: "infinity" }));
    expect(screen.getByTestId("devolver-ao-automatico")).toBeTruthy();
    expect(screen.queryByTestId("pausar-automatico")).toBeNull();
  });

  it("já pausada por force_human do contato: mostra 'Devolver ao automático', não mostra 'Pausar automático'", () => {
    renderHeader(
      baseConversation({
        contacts: { id: "ct-1", display_name: "Fulana", name: null, phone_number: "5511999", force_human: true },
      }),
    );
    expect(screen.getByTestId("devolver-ao-automatico")).toBeTruthy();
    expect(screen.queryByTestId("pausar-automatico")).toBeNull();
  });

  it("conversa fechada: nenhum dos dois botões aparece", () => {
    renderHeader(baseConversation({ status: "closed" }));
    expect(screen.queryByTestId("pausar-automatico")).toBeNull();
    expect(screen.queryByTestId("devolver-ao-automatico")).toBeNull();
  });

  it("clicar 'Pausar automático' chama a mutation com o id da conversa", () => {
    renderHeader(baseConversation());
    screen.getByTestId("pausar-automatico").click();
    expect(pausarMutate).toHaveBeenCalledWith({ conversation_id: "cv-1" });
  });
});
