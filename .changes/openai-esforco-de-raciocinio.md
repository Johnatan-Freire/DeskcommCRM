---
impacto: capacidade_nova
secao: adicionado
titulo: Dá para regular o raciocínio dos modelos da OpenAI com OPENAI_REASONING_EFFORT
---

Os modelos de raciocínio da OpenAI (gpt-5.x, gpt-6) pensam antes de responder, e no atendimento pelo WhatsApp isso vira espera: medido com `gpt-6-luna`, o rascunho levava de 9 a 27 s, com uns 700 tokens de raciocínio para uma resposta de 40, e às vezes o modelo nem chamava a ferramenta de envio. Com `OPENAI_REASONING_EFFORT=none` no `.env`, a mesma chamada caiu de uns 5 s para uns 2 s e chamou a ferramenta todas as vezes. Valores aceitos: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`; vazio mantém o padrão do modelo. Vale só para o provedor OpenAI direto e só para modelos que raciocinam (`o*`, `gpt-5*`, `gpt-6*`, fora as variantes `-chat`); os demais seguem sem o campo. Grafia errada impede o worker de subir e o log diz qual variável corrigir. Contribuição de @rogercampel (#1598).
