---
impacto: nada_mudou
secao: corrigido
titulo: A descrição de imagem usa o modelo escolhido para visão mesmo quando o provedor padrão da empresa está sem chave
---

Organizações que usavam binding específico em `visao_de_imagem` mas não tinham credencial configurada no modelo de chat padrão (por exemplo, durante onboarding ou com Gemini sem chave cadastrada) falhavam prematuramente ao tentar derivar mídias de imagem, porque o worker resolvia a configuração padrão da organização antes de inspecionar o binding dedicado do ponto. Agora, o binding da visão é consultado e resolvido prioritariamente, recorrendo ao padrão da organização apenas como fallback. Crédito: @webtecnica. Relato: @rogercampel.
