/**
 * O painel «Importar histórico» no cartão do número (Conexões).
 *
 * Quem decide se a pessoa é admin é o servidor: 403 na listagem = o painel não
 * aparece. O pedido leva só a janela em dias; a tela diz que nada é enviado; a
 * falha por Store desligado é explicada sem oferecer mexer na sessão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/types";

const getMock = vi.fn();
const postMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    delete: (...a: unknown[]) => deleteMock(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ChannelHistoryImport } from "@/components/connections/ChannelHistoryImport";

const CANAL = "11111111-1111-4111-8111-111111111111";

const recibo = (over: Record<string, unknown> = {}) => ({
  id: "22222222-2222-4222-8222-222222222222",
  channel_session_id: CANAL,
  status: "concluida",
  motivo_falha: null,
  janela_inicio: "2026-06-23T19:41:34Z",
  janela_fim: "2026-09-21T19:41:34Z",
  conversas_total: 12,
  conversas_processadas: 12,
  mensagens_importadas: 340,
  mensagens_duplicadas: 5,
  mensagens_fora_da_janela: 0,
  mensagens_descartadas: 0,
  contatos_criados: 10,
  conversas_criadas: 10,
  created_at: "2026-10-06T00:00:00Z",
  started_at: "2026-10-06T00:00:01Z",
  finished_at: "2026-10-06T00:02:00Z",
  ...over,
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChannelHistoryImport channelId={CANAL} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  deleteMock.mockReset();
});
afterEach(cleanup);

describe("painel «Importar histórico»", () => {
  it("quem não é admin (403 do servidor) não vê o painel", async () => {
    getMock.mockRejectedValue(new ApiError(403, "forbidden", undefined, "r"));
    const { container } = montar();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="historico-do-whatsapp"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Importar histórico" })).toBeNull();
  });

  it("admin sem importação vê o botão; o formulário diz que nada é enviado e pede só a janela", async () => {
    getMock.mockResolvedValue({ data: [] });
    postMock.mockResolvedValue({ data: recibo({ status: "pendente" }) });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Importar histórico" }));
    expect(screen.getByText(/Nada é respondido nem enviado/)).toBeTruthy();
    expect(screen.getByText(/entram fechadas/)).toBeTruthy();
    const campo = screen.getByLabelText("Quantos dias antes da conexão do número") as HTMLInputElement;
    expect(campo.value).toBe("90");
    fireEvent.change(campo, { target: { value: "30" } });
    const botoes = screen.getAllByRole("button", { name: "Importar histórico" });
    fireEvent.click(botoes[botoes.length - 1]!);
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(`/api/v1/channel-sessions/${CANAL}/history-imports`, { janela_dias: 30 });
  });

  it("janela fora de 1–730 não é pedida", async () => {
    getMock.mockResolvedValue({ data: [] });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Importar histórico" }));
    fireEvent.change(screen.getByLabelText("Quantos dias antes da conexão do número"), { target: { value: "5000" } });
    const botoes = screen.getAllByRole("button", { name: "Importar histórico" });
    fireEvent.click(botoes[botoes.length - 1]!);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("importação viva: mostra progresso, esconde o botão de pedir e permite cancelar", async () => {
    getMock.mockResolvedValue({ data: [recibo({ status: "em_andamento", conversas_processadas: 4, mensagens_importadas: 90 })] });
    deleteMock.mockResolvedValue({ data: recibo({ status: "cancelada" }) });
    montar();
    expect(await screen.findByText("Histórico: importando")).toBeTruthy();
    expect(screen.getByText(/4\/12 conversas lidas/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Importar histórico" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar importação" }));
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        `/api/v1/channel-sessions/${CANAL}/history-imports/22222222-2222-4222-8222-222222222222`,
      ),
    );
  });

  it("Store desligado é explicado — e a tela não oferece mexer na sessão", async () => {
    getMock.mockResolvedValue({ data: [recibo({ status: "falhou", motivo_falha: "store_desligado", mensagens_importadas: 0 })] });
    montar();
    expect(await screen.findByText(/armazenamento de conversas está desligado/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reconectar|ativar|QR/i })).toBeNull();
  });

  it("resposta fora do formato não vira tela", async () => {
    getMock.mockResolvedValue({ data: { inesperado: true } });
    montar();
    expect(await screen.findByRole("button", { name: "Importar histórico" })).toBeTruthy();
  });
});
