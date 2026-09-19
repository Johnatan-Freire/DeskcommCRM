---
impacto: nada_mudou
secao: corrigido
titulo: Anonimizar um contato retoma de onde parou, em vez de dizer que já foi
---

A anonimização de um contato remove os dados pessoais em três lugares: o
cadastro do contato, os títulos dos negócios dele e o histórico de
atividades. Se a operação era interrompida no meio — o navegador desistindo,
o servidor reiniciando — o primeiro lugar ficava pronto e os outros dois não,
e não havia como terminar: a tela dizia "já anonimizado" e não fazia mais
nada, mesmo com dados pessoais ainda visíveis nos negócios e no histórico.

Agora a verificação diária do sistema encontra sozinha as anonimizações que
ficaram pela metade e termina o serviço, sem ninguém precisar procurar
contato por contato. Rodar de novo num contato já inteiro não escreve nada, e
o registro de auditoria mostra o que foi realmente feito, em qual contato e
em que dia — separado da execução original, para a data em que o titular
exerceu o direito não ser sobrescrita.
