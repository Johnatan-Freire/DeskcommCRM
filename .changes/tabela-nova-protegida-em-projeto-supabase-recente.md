---
impacto: nada_mudou
secao: corrigido
titulo: Instalação em projeto Supabase recente não deixa tabela sem o isolamento entre empresas
---

Projetos do Supabase criados recentemente ligam sozinhos a proteção de linha
(RLS) de toda tabela nova. Isso cegava a rotina do CRM que acrescenta a regra
"cada empresa vê só o que é seu": a tabela ficava protegida mas SEM a regra, e
nenhum usuário do CRM conseguia ler nem gravar nela. Numa instalação nova
nesse tipo de projeto, várias telas apareciam vazias ou falhavam ao salvar.

Agora, depois de aplicar todo o schema, uma verificação final dá a regra de
isolamento a toda tabela que ficou nesse estado — sem tocar nas tabelas que
são, de propósito, só do servidor, nem nas que têm regras próprias por perfil.
Em instalações que já funcionam nada muda: a verificação não encontra nada a
corrigir.
