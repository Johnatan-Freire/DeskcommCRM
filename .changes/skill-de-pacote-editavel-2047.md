---
impacto: capacidade_nova
secao: corrigido
titulo: Skill importada por .zip volta a ser editável na tela sem perder references/ e assets/
---

Uma skill instalada pelo .zip com `references/` ou `assets/` abria no editor, mas o botão Salvar chegava desabilitado e a API respondia 409: qualquer ajuste de descrição, palavra-chave ou corpo exigia reconstruir o pacote inteiro e subir o .zip de novo. O veto existia por um motivo de verdade — os objetos moram no Storage sob o id da versão, e a versão nova nasceria sem eles, o que faria o agente perder as references em silêncio —, mas o preço cobrado de quem só queria corrigir uma frase era desproporcional.

A edição textual passou a ser livre e a herança, explícita. O PUT cria a versão nova já com o manifesto da anterior e copia cada arquivo para o prefixo novo antes de mover o ponteiro, na mesma ordem do import: falha na cópia responde 500, remove o que já tinha subido e não anda com o ponteiro, então quem joga continua vendo a versão antiga com os arquivos intactos e nada de prefixo pela metade fica no bucket. A edição ESTRUTURAL continua travada de propósito: o corpo do PUT é estrito, então tentar mandar `manifest` pelo editor devolve 422, e a tela lista os arquivos do pacote como somente leitura dizendo que adicionar, trocar ou remover arquivo é por novo .zip.

Contribuição de @webtecnica (refs #2047).
