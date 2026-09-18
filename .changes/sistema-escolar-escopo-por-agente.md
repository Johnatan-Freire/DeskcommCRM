---
impacto: capacidade_nova
secao: adicionado
titulo: Cada agente escolhe o que consulta no sistema escolar
---

Até aqui, quando a integração com o sistema escolar estava ativa, qualquer
agente de IA publicado ganhava acesso às duas consultas automaticamente:
dados de aluno matriculado (matrícula, notas, faltas, situação financeira) e
catálogo público de cursos. Não havia como restringir — um agente pensado para
vender curso conseguia puxar nota de aluno sabendo só o telefone, e um agente
de suporte a alunos conseguia cotar preço.

Agora cada agente tem sua própria marcação, na aba Configuração do editor de
agentes (só aparece quando a organização tem a integração configurada):
"Consultar dados de aluno já matriculado" e "Consultar catálogo de cursos" são
switches independentes. Um agente pode ter as duas, uma só, ou nenhuma.

Agentes que já existiam continuam funcionando exatamente como antes — as duas
consultas seguem ligadas para eles. Um agente novo nasce sem nenhuma das duas
marcadas; quem publica escolhe o que faz sentido para aquele agente.
