---
impacto: nada_mudou
secao: alterado
titulo: Suíte de testes do kit hermetiza as chaves de IA do ambiente
---

A suíte de testes do kit de instalação passa a zerar ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY e AI_GATEWAY_API_KEY no ambiente antes de rodar os casos. O caso que instala sem chave de IA passa a medir só o que o teste escreve, em vez de o que o ambiente de quem executa exporta. Quem roda a suíte com uma chave de IA exportada no terminal deixa de ver uma falha falsa nesse caso. Não há ação para quem opera a VPS.

Contribuição de @webtecnica (#1599).
