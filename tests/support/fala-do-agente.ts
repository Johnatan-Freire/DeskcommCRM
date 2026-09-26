/**
 * Dublê da consulta "de quem é a última fala da IA" da varredura de silêncio
 * (`lib/followup/origem-da-pendencia.ts`).
 *
 * Os fakes de PostgREST da varredura devolvem o MESMO `data` para qualquer tabela.
 * A consulta de `messages` é nova e precisa de resposta própria: aqui ela devolve
 * uma fala da IA assinada por `autor` — por padrão, o agente que habilita o fluxo
 * nos testes (`AGENTE_DO_FLUXO`). As demais tabelas seguem com o fake original.
 */
export const AGENTE_DO_FLUXO = "00000000-0000-4000-8000-00000000a9e7";

function cadeiaQueResolve(data: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
        return () => chain;
      },
    },
  );
  return chain;
}

export function comFalaDoAgente(client: unknown, autor: string | null = AGENTE_DO_FLUXO): never {
  const original = client as { from: (tabela: string) => unknown } & Record<string, unknown>;
  const falas = cadeiaQueResolve(autor === null ? [] : [{ metadata: { ai_actor_id: autor } }]);
  return {
    ...original,
    from: (tabela: string) => (tabela === "messages" ? falas : original.from(tabela)),
  } as never;
}
