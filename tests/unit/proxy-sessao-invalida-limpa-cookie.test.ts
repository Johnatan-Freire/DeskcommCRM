/**
 * SESSÃO QUE NÃO RENOVA SAI DO NAVEGADOR — o proxy não pode responder sem o
 * apagamento do cookie.
 *
 * ─── O defeito (medido em produção em 2026-10-02, depois da troca de projeto) ──
 *
 * Quem ficou com uma aba aberta antes da troca para o projeto de Estocolmo
 * mandava, a cada consulta periódica, o cookie `sb-deskcomm-auth` do projeto
 * antigo. O `getUser()` do proxy tentava renovar a sessão, o GoTrue novo
 * respondia `refresh_token_not_found`, e o cliente do Supabase fazia o certo:
 * pedia, pelo `setAll`, que o cookie fosse APAGADO — no `response` do proxy.
 * Só que o ramo "sem usuário" devolve um objeto NOVO (o 401 das rotas `/api/`,
 * o redirect das telas), e o apagamento ficava no objeto descartado. O
 * navegador guardava o cookie morto e a próxima consulta repetia a renovação:
 * ~8 erros por minuto no log, constantes por horas, sem cair sozinhos.
 *
 * Este arquivo usa o cliente REAL do `@supabase/ssr` — só o `fetch` para o
 * GoTrue é interceptado, devolvendo o mesmo 400 da produção. Assim o teste mede
 * o que o cliente de verdade pede e o que o proxy de verdade devolve.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

const NOME = "sb-deskcomm-auth";

/** Cookie no formato do @supabase/ssr com uma sessão VENCIDA (força a renovação). */
function cookieDeSessaoVencida(): string {
  const corpo = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwtVencido = `${corpo({ alg: "HS256", typ: "JWT" })}.${corpo({ sub: "u-1", exp: 1_600_000_000, role: "authenticated" })}.assinatura`;
  const sessao = {
    access_token: jwtVencido,
    refresh_token: "refresh-do-projeto-antigo",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1_600_000_000,
    user: { id: "u-1", aud: "authenticated", role: "authenticated", email: "x@exemplo.invalid" },
  };
  return `base64-${Buffer.from(JSON.stringify(sessao)).toString("base64url")}`;
}

function goTrueRecusaARenovacao() {
  const chamadas: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      chamadas.push(u);
      if (u.includes("/auth/v1/token")) {
        return new Response(JSON.stringify({ code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ code: "bad_jwt", message: "invalid JWT" }), { status: 403, headers: { "content-type": "application/json" } });
    }),
  );
  return chamadas;
}

const requisicao = (caminho: string, cookie?: string) =>
  new NextRequest(new URL(caminho, "https://crm.exemplo.invalid"), { headers: cookie ? { cookie: `${NOME}=${cookie}` } : {} });

/** O cookie de sessão foi mandado APAGAR nesta resposta? */
function apagouASessao(res: Response): boolean {
  const linhas = res.headers.getSetCookie();
  return linhas.some((l) => l.startsWith(`${NOME}=`) && (/Max-Age=0/i.test(l) || /Expires=Thu, 01 Jan 1970/i.test(l)));
}

afterEach(() => vi.unstubAllGlobals());

describe("proxy: sessão que o GoTrue não renova", () => {
  it("rota de API: 401 E o cookie morto é apagado (senão a consulta seguinte repete a renovação)", async () => {
    const chamadas = goTrueRecusaARenovacao();
    const res = await proxy(requisicao("/api/v1/conversations/counts", cookieDeSessaoVencida()));
    expect(chamadas.some((u) => u.includes("/auth/v1/token"))).toBe(true); // a renovação foi tentada, como na produção
    expect(res.status).toBe(401);
    expect(apagouASessao(res)).toBe(true);
  });

  it("tela: redirect para o login E o cookie morto é apagado", async () => {
    goTrueRecusaARenovacao();
    const res = await proxy(requisicao("/app/inbox", cookieDeSessaoVencida()));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?next=%2Fapp%2Finbox");
    expect(apagouASessao(res)).toBe(true);
  });

  it("controle: sessão VÁLIDA segue para a rota e o cookie NÃO é apagado", async () => {
    const corpo = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const futuro = Math.floor(Date.now() / 1000) + 3600;
    const jwt = `${corpo({ alg: "HS256", typ: "JWT" })}.${corpo({ sub: "u-1", exp: futuro, role: "authenticated" })}.assinatura`;
    const sessao = { access_token: jwt, refresh_token: "r-ok", token_type: "bearer", expires_in: 3600, expires_at: futuro,
      user: { id: "u-1", aud: "authenticated", role: "authenticated", email: "x@exemplo.invalid" } };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u-1", aud: "authenticated", role: "authenticated", email: "x@exemplo.invalid" }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 500 });
    }));
    const res = await proxy(requisicao("/app/inbox", `base64-${Buffer.from(JSON.stringify(sessao)).toString("base64url")}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(apagouASessao(res)).toBe(false);
  });

  it("depois do apagamento, sem cookie: nenhuma renovação é tentada (o ciclo acaba)", async () => {
    const chamadas = goTrueRecusaARenovacao();
    const res = await proxy(requisicao("/api/v1/conversations/counts"));
    expect(res.status).toBe(401);
    expect(chamadas.filter((u) => u.includes("/auth/v1/token"))).toEqual([]);
    expect(res.headers.getSetCookie().filter((l) => l.startsWith(`${NOME}=`))).toEqual([]);
  });
});
