---
impacto: capacidade_nova
secao: alterado
titulo: Em "Cadastro", a tela avisa quando a troca de modo ainda não chegou ao cadastro direto do Supabase
---

Trocar o modo em /admin/cadastro valia na hora para as regras do CRM, mas o cadastro direto do Supabase continuava como estava: no kit de servidor único ele só acompanha no install e no update.sh, e com Supabase separado ele nunca acompanha sozinho. Agora /admin/cadastro confere o que o GoTrue está aplicando e avisa quando isso difere do modo gravado. No servidor único, o aviso traz o comando para aplicar já (bash hostgator-setup-kit/update.sh). Com Supabase separado, ele diz o que mudar no painel (Authentication → Sign In / Up → Allow new users to sign up) ou no DISABLE_SIGNUP de um GoTrue próprio. Se não der para perguntar ao GoTrue, não há aviso, e nada é corrigido sozinho: a tela só avisa.

Contribuição de @webtecnica (#1668).
