---
impacto: nada_mudou
secao: corrigido
titulo: Quatro bibliotecas internas sobem de versão para fechar avisos de segurança
---

O aviso automático de segurança do repositório apontou quinze alertas em quatro bibliotecas que o sistema usa por dentro. Três vão na instalação: `ip-address` (lida com endereços IP no limite de requisições do servidor MCP), `fast-uri` (interpreta endereços na validação de esquemas) e `brace-expansion` (expande padrões de nomes de arquivo). A quarta, `undici`, é usada só nos testes do projeto.

Todas subiram para versões corrigidas dentro da mesma linha que já usavam (`ip-address` 10.7.3, `fast-uri` 3.1.8, `brace-expansion` 1.1.21 e 5.0.12, `undici` 8.11.2). Nenhuma tela, nenhuma configuração e nenhum comando mudam: quem opera uma VPS só precisa atualizar como de costume.
