---
impacto: capacidade_nova
secao: adicionado
titulo: Agentes de IA podem consultar um sistema escolar externo
---

Organizações que operam um sistema de gestão escolar externo (via API própria em
`/api/deskcomm/*`) agora podem ligar essa integração em Configurações › Sua empresa ›
Sistema escolar: informe a URL e a chave de API, e a conexão é testada na hora. A chave
fica cifrada e nunca volta a aparecer na tela depois de salva.

Com a integração ativa, cada agente de IA escolhe — na aba Configuração do editor de
agentes — o que pode consultar: dados de aluno já matriculado (matrícula, notas, faltas
e situação financeira, pelo telefone da conversa) e/ou o catálogo público de cursos e
pacotes (preço, parcelamento, trilha). Os dois são independentes: um agente de vendas
pode ter só o catálogo, e um agente de suporte a alunos só a consulta de matrícula.

Quando o telefone da conversa pertence a mais de um aluno (ex.: irmãos com o mesmo
responsável), o agente pede o nome completo antes de mostrar qualquer dado — nunca
escolhe por aproximação nem mistura o cadastro de duas pessoas.

Instalações que não configuram essa integração não são afetadas: sem a URL e a chave
cadastradas, nenhuma das duas consultas aparece para nenhum agente.
