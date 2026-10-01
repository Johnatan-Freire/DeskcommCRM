---
impacto: nada_mudou
secao: corrigido
titulo: O nome da marca no onboarding segue a configuração da tela Marca
---

As telas de boas-vindas, de primeiro acesso e o cabeçalho do onboarding escreviam o nome da marca lido só do arquivo de instalação (.env), então quem trocou o nome em Administração › Marca continuava vendo o nome antigo justamente nas primeiras telas. Agora elas usam o mesmo resolvedor do título da aba: a configuração salva na tela vence, e o .env segue como reserva. Sem marca própria configurada, nada muda.

Refs #1944

Contribuição de @webtecnica (#1961).
