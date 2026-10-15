/**
 * O padrão de IA da organização está INCOERENTE? — puro (auditoria de agentes).
 *
 * Medido em produção (14/10/2026): `settings.llm = { provider: 'openai',
 * default_model: 'claude-sonnet-5' }`. As duas portas de escrita de hoje gravam o
 * par junto (onboarding e a tela), mas o dado ANTIGO ficou, e todo ponto sem
 * agente (sentimento, classificadores de fluxo) mandaria um modelo da Anthropic ao
 * endpoint da OpenAI. A tela precisa dizer isso a quem pode consertar.
 *
 * Só afirma incoerência quando há catálogo do provedor para conferir: sem nenhum
 * modelo daquele provedor no catálogo (instalação nova, catálogo ainda vazio),
 * não há como saber — e não se acusa.
 */
export function padraoIncoerente(
  padrao: { provider: string; defaultModel: string | null },
  catalogo: ReadonlyArray<{ provider: string; model_id: string }>,
): boolean {
  if (padrao.defaultModel === null) return false;
  const doProvedor = catalogo.filter((m) => m.provider === padrao.provider);
  if (doProvedor.length === 0) return false;
  return !doProvedor.some((m) => m.model_id === padrao.defaultModel);
}
