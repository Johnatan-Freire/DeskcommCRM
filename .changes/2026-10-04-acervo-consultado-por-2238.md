---
impacto: nada_mudou
secao: corrigido
titulo: O selo "Consultado por" do acervo de conhecimento volta a mostrar os assistentes que usam cada material
---

Na tela de materiais da base de conhecimento, todo material aparecia com "Consultado por: nenhum assistente ainda", mesmo quando a versão publicada de um assistente o usava em conversa. A consulta da tela era recusada pelo banco por ambiguidade, e a recusa era descartada em silêncio. Agora a tela lê a versão publicada de cada assistente e mostra quem consulta o material. Se a consulta falhar por outro motivo, a tela continua abrindo, e a causa fica registrada no log do servidor. Nenhuma ação do operador.

Contribuição de @webtecnica (#2238, fecha #2236, relatada por @kristhianlumai-lgtm).
