import { beforeEach, describe, expect, it, vi } from "vitest";

import { apagarNoGoogle, idDeEventoDoGoogle, publicarNoGoogle } from "@/lib/agenda/google/escrita";
import type { AgendamentoParaGoogle } from "@/lib/agenda/google/evento";

/**
 * A IDA — e as três propriedades que ela precisa ter para não estragar a agenda
 * pessoal de quem atende.
 *
 * 1. IDEMPOTÊNCIA. Todo cron roda duas vezes algum dia. Se a segunda ida criar um
 *    segundo evento, o cliente vê a mesma consulta duplicada na agenda dele — e
 *    o horário fica bloqueado em dobro.
 * 2. APAGAR É "NÃO EXISTE MAIS", não "a chamada deu 200". 404 e 410 são o estado
 *    desejado; tratá-los como erro encheria a Central de aviso que não é falha.
 * 3. ERRO CLASSIFICADO, não engolido: o desfecho decide se o worker tenta de
 *    novo, rebaixa a conexão ou pede reautenticação.
 */

const AGENDAMENTO: AgendamentoParaGoogle = {
  id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  organization_id: "aaaaaaaa-0000-4000-8000-00000000000a",
  title: "Consulta",
  starts_at: "2026-09-02T13:00:00.000Z",
  ends_at: "2026-09-02T13:30:00.000Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  location_kind: "in_person",
};

function resposta(status: number, corpo: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("o id do evento no Google", () => {
  it("é derivado do agendamento e estável entre chamadas", () => {
    expect(idDeEventoDoGoogle(AGENDAMENTO.id)).toBe(idDeEventoDoGoogle(AGENDAMENTO.id));
  });

  it("respeita o alfabeto que o Google aceita — [a-v0-9], mínimo 5", () => {
    const id = idDeEventoDoGoogle(AGENDAMENTO.id);
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it("CONTROLE: ids diferentes não colidem", () => {
    // Sem isto, uma normalização agressiva demais (por exemplo, remover TODO
    // caractere não-alfabético e truncar) passaria nos dois casos acima e
    // mandaria dois compromissos para o MESMO evento no Google.
    const a = idDeEventoDoGoogle("0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e");
    const b = idDeEventoDoGoogle("0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4f");
    expect(a).not.toBe(b);
  });
});

describe("publicar", () => {
  it("usa PUT no id derivado — reenviar ATUALIZA, não duplica", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "deskcommabc", sequence: 3 }));
    const r = await publicarNoGoogle("tok", "ana@clinica.com.br", AGENDAMENTO);
    expect(r.ok).toBe(true);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(
      init.method,
      "POST criaria um evento novo a cada rodada do cron — a agenda do cliente " +
        "encheria de cópias da mesma consulta",
    ).toBe("PUT");
    expect(url).toContain(idDeEventoDoGoogle(AGENDAMENTO.id));
    expect(url).toContain(encodeURIComponent("ana@clinica.com.br"));
  });

  it("devolve o sequence que o Google mandou — é o que detecta edição alheia", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "x", sequence: 7 }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok && r.sequence).toBe(7);
  });

  it("erro do Google vira CLASSIFICAÇÃO, não exceção solta", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resposta(403, { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } }),
    );
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.classificacao.desfecho, "403 de escopo não pode virar retry infinito").toBe(
        "sem_permissao",
      );
    }
  });

  it("falha de REDE também é classificada — e é retentável", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.classificacao.desfecho).toBe("transitorio");
  });
});

describe("apagar", () => {
  it("404 é SUCESSO — o evento não existe mais, que é o estado desejado", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(404, {}));
    const r = await apagarNoGoogle("tok", "cal", AGENDAMENTO.id);
    expect(
      r.ok,
      "tratar 404 como erro encheria a Central de avisos com uma falha que não é falha",
    ).toBe(true);
  });

  it("410 também", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(410, {}));
    expect((await apagarNoGoogle("tok", "cal", AGENDAMENTO.id)).ok).toBe(true);
  });

  it("CONTROLE: 500 NÃO é sucesso — senão o par acima passa por tolerar tudo", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(500, {}));
    expect((await apagarNoGoogle("tok", "cal", AGENDAMENTO.id)).ok).toBe(false);
  });
});
