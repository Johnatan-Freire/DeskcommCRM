---
impacto: nada_mudou
secao: corrigido
titulo: A gravação de sessão do diagnóstico de erros passa pelo mesmo filtro de URL do resto da telemetria
---

A gravação de sessão que acompanha os relatórios de erro passa a aplicar às URLs o mesmo filtro que o resto da telemetria já aplicava: valores de parâmetro e segmentos de credencial no caminho saem redigidos. Nas páginas que trazem credencial na própria URL, como o link de convite, a gravação de sessão não acontece. O relatório de erro dessas páginas continua sendo enviado. Nada muda para quem opera a instalação.
