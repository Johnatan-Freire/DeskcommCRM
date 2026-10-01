---
impacto: nada_mudou
secao: corrigido
titulo: Só gerente ou administrador consegue cancelar ou apagar uma inscrição de follow-up pelo acesso direto ao banco
---

Qualquer membro da organização, inclusive quem só tem o papel de visualizador, conseguia apagar ou alterar uma inscrição de follow-up, ou um fluxo inteiro, falando direto com o banco pela chave pública do sistema e pela própria sessão, sem passar pelas telas e sem ficar registrado na auditoria. Apagar a inscrição levava junto o histórico dela e as mensagens de follow-up já agendadas. Agora só quem tem o papel de gerente ou de administrador consegue criar, alterar, cancelar ou apagar uma inscrição ou um fluxo de follow-up por esse caminho, que é o mesmo papel que as telas e a API já exigiam. A leitura continua liberada para todos os membros, e as telas e os envios automáticos funcionam como antes. Não há nada para fazer: a regra entra sozinha na próxima atualização.
