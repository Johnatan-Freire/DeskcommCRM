/**
 * `ConversationListItem` — a bolinha de quem atende (#2075 do upstream).
 * Neste fork o arquivo nasce só com esse bloco: o do upstream começou na
 * feature de grupos na inbox (#1647), que não foi portada. Props mínimas via
 * `__fixtures__/conversa.ts`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationListItem } from "./ConversationListItem";
import { conversaDeExemplo } from "./__fixtures__/conversa";

/**
 * A bolinha no canto do avatar. A cor sai de quem está no comando, mas cor
 * sozinha não se explica — a palavra vem junto, no `title` e no nome acessível.
 */
describe("ConversationListItem — bolinha de quem atende", () => {
  it("a bolinha do avatar diz em palavras quem está no comando", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          assigned_to_user_id: "user-1",
          assigned_to_user_name: "Ana",
          assignee_kind: "user",
        }}
        {...conversaDeExemplo.props}
      />,
    );
    const bolinha = screen.getByRole("img", { name: "Em atendimento" });
    expect(bolinha).toHaveAttribute("title", "Em atendimento");
  });

  it("conversa encerrada: a bolinha diz Encerrada", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, status: "closed" }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByRole("img", { name: "Encerrada" })).toHaveAttribute("title", "Encerrada");
  });

  // O caminho comum da aba de fechadas: alguém assumiu e fechou. Fechar não solta
  // o dono (`fn_service_status`), e `comandoDaConversa` segue dizendo `humano` de
  // propósito — mas a PALAVRA "Em atendimento" afirmaria um atendimento que acabou.
  it("conversa encerrada COM dono: a bolinha diz Encerrada, nunca Em atendimento", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          status: "closed",
          assigned_to_user_id: "user-1",
          assigned_to_user_name: "Ana",
          assignee_kind: "user",
        }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByRole("img", { name: "Encerrada" })).toHaveAttribute("title", "Encerrada");
    expect(screen.queryByRole("img", { name: "Em atendimento" })).toBeNull();
  });
});
