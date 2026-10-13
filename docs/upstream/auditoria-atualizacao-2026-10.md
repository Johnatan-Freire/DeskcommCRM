# Auditoria e atualização seletiva do upstream v1.70 → main (outubro de 2026)

O upstream (`melgarafael/DeskcommCRM`) é **fonte de correções e recursos**, não o estado desejado
deste fork. Esta integração continua a de `docs/upstream/integracao-v1.69.md`, com o mesmo método e
a mesma regra de conflito: **a regra da Capital Code vence**. Nada foi aplicado em produção, nenhum
merge na `main`, nenhum deploy, e nenhum envio de mensagem foi ligado.

## 1. Resumo executivo

**Estado inicial**

| Referência | SHA |
|---|---|
| Fork `origin/main` antes da integração | `c1b716b5c` |
| Upstream `upstream/main` analisado (último PR: #2805, 12/10/2026) | `0c05ca348` |
| Ancestral comum | `ebb7d03e` (v1.47.0) |
| Última integração efetiva do fork | v1.69.0 (`e8e291217`) |
| Release mais recente do upstream | v1.80.0 (`bfa137251`) + PRs posteriores até #2805 |
| Branch de integração | `integracao/upstream-v1.80` |
| Checkpoint de volta | tag `checkpoint/pre-upstream-v1.80-20261013T020232Z` (= `c1b716b5c`) e bundle `pre-upstream-v1.80-20261013T020232Z.bundle` (SHA256 `55816508d6cf1322c5c7b41742e900ce7fc02ffc2075d5b86bc22628697e9f44`) |

**Números**

| | Quantidade |
|---|---|
| Itens first-parent em `v1.69.0..upstream/main` | 454 |
| — PRs de release (fora) | 11 |
| — **PRs funcionais avaliados** | **443** |
| **Portados sem conflito (PORTAR)** | **169** |
| **Portados com adaptação (ADAPTAR)** | **107** |
| **Adiados (ADIAR)** | **50** |
| **Não se aplicam (NÃO SE APLICA)** | **117** |
| Já incorporados (cherry-pick vazio) | 0 |
| Migrations novas no fork | 49 (46 do upstream, 2 do upstream reescritas a partir do fork, 1 própria do fork) |

"Portado" = o PR entrou com cherry-pick (`-x`, rastreável). "Adaptado" = entrou com mudança para
preservar uma regra do fork; a nota de adaptação está na mensagem de cada commit
(`git log origin/main..HEAD --grep "Adaptação no fork"`) e na tabela da seção 7.

## 2. Funcionalidades exclusivas preservadas

| Regra do fork | Como foi preservada nesta integração | Prova |
|---|---|---|
| **Sistema Escolar** (`/api/deskcomm/*`, identidade escolar, preços, cursos) | Nenhum PR do upstream toca essa API; os testes estáticos do envio que relêem o escopo da etapa foram atualizados para a forma nova do handler (#2338) | `tests/unit/identidade-escolar-antes-do-agente.test.ts`, `capital-code-golden-invariants` |
| **Agentes comercial × acadêmico** | Destino de funil do roteador (#2290) só vale para agente comercial com `can_update_lead_state`; a conferência de etapa (`assertEscopoDaEtapaSupabase`) continua a cada envio, fora da economia do #2338; `fn_ai_agent_version_content_immutable` não foi recriada a partir do upstream (#2156 adiado) | `destino-da-intencao-respeita-politica-de-etapa.test.ts`, `envio-por-bolha-confere-uma-vez.test.ts` (caso do fork, sabotado) |
| **Política por etapa / `exit_locked`** | `transfereParaOFunil` recusa origem travada ANTES de clonar (fechou também um furo antigo da automação `create_or_move_lead`); o PARAR (#2049) não tira o card de etapa travada; follow-up `move_lead` (#2181/#2552) adiado | invariante `motivo-de-perda-de-quem-pediu-para-parar` (caso novo), `pos-entrada-efeitos-do-canal` (caso novo, sabotado), invariante `politica-de-atendimento-por-etapa` |
| **Trava `OUTBOUND_MESSAGING` (fail-closed)** | Todo PR que envia passou pela cerca; os novos caminhos (pausa de canal #2318, texto fixo na janela #2677, correção de turno mudo #2607, interromper turno #2541) recusam mais, nunca menos | `tests/unit/trava-global-de-envio.test.ts` (varre endpoints) |
| **Deploy próprio (`scripts/deploy-vps.sh`)** | O compose de produção mantém `WHATSAPP_HOOK_HMAC` (#2268 adaptado); `WHATSAPP_HOOK_URL` segue na rede interna (compatível com #2618); kit HostGator só recebeu o bloco do CPF | `tests/unit/waha-hook-hmac-key.test.ts` (as duas metades, sabotado) |
| **RLS da Inbox (0560) e otimizações** | Push de mensagem (#2590) usa a mesma `fn_can_view_conversation` do fork; `comando_da_conversa` (#2748) reescrito para a assinatura de 6 argumentos do fork | invariantes de RLS e `comando-da-conversa-sem-reavaliar-rls` |
| **Isolamento entre organizações** | Toda migration nova conferida contra a definição do fork (`checkobj.py`); cerca R3 de tenant (#2598) aplicada ao código do fork | `rls-isolation` (2 organizações) no `test:db`, `admin-client-exige-filtro-de-tenant` |

## 3. Melhorias mais relevantes que o CRM recebeu

Defeitos reais **do fork** corrigidos (cada um com teste novo, sabotado):

1. **Follow-up que morria em silêncio** — turno descartado com a inscrição pausada matava a
   inscrição como `action_turn_never_completed` (#2277 + consumidor `turn_discarded` portado da 0501).
2. **Resposta automática por cima de quem assumiu** — assumir a conversa agora interrompe o turno
   autônomo em voo (#2541, 0594/0615).
3. **Texto fixo do follow-up fora da janela de disparo** — podia sair de madrugada (#2677).
4. **Clima da conversa cobrando com "parar a IA"** — o worker de sentimento ignorava o teto de
   gasto (#2583).
5. **LGPD: poda de retenção que falhava pulava a anonimização do dia** (SLA D+15) — reescrito na
   rota do fork (#2645, #2653).
6. **Automação de troca de funil duplicava o card** em etapa travada (fechado junto do #2290).
7. **Export do titular** mostrava o token cru da menção (UUID do atendente) — agora `@Nome`.

Recursos e correções do upstream (seleção): destino de funil por intenção do roteador (#2290 +
#2431), menções em nota interna (#2461, #2489), tarefas no card do negócio (#2760), respostas
rápidas com nome do contato (#2764), STOP encerra follow-up pausado (#2782), visão Calendário do
funil (#2790), troca rápida de funil (#2731), divisórias arrastáveis na Inbox (#2604), export da
conversa em PDF (#2229), pausa de canal e pausa agendada (#2318, #2433, #2496, #2673), formulários
personalizados por fonte (#2570), autorização de IA por formulário (#2452), CPF cifrado (#2551),
recusa permanente como `PT409` (#2805, 0654), eco do WhatsApp sem duplicar mensagem (#2468, #2525),
push só a quem pode ver a conversa (#2590, #2592), dependências com alerta de segurança (#2477,
Next 16.3.8 #2536), e dezenas de correções de Inbox, agenda, métricas e LGPD (tabela da seção 7).

## 4. Matriz de comparação (funcionalidades relevantes)

| Funcionalidade | Nosso fork | Original | Melhor | Decisão | Justificativa | Referência | Risco |
|---|---|---|---|---|---|---|---|
| Recusa permanente `PT409` (0654) | `40001` (o PostgREST retentava) | `PT409` em 16 funções | Original | PORTAR | `checkobj` sem divergência nas 16 funções; `service_contact_changed`, `appointment_notice_busy`, `contact_redaction_busy` seguem `40001` | #2805 | Baixo |
| Destino de funil do roteador | Inexistente | Move card ao funil da intenção | Original + travas do fork | ADAPTAR | Só etapa comercial, agente comercial com permissão; recusa `exit_locked` antes de clonar | #2290, #2431 | Médio |
| HMAC do webhook WAHA | Nome antigo (WAHA não assina) | `WHATSAPP_HOOK_HMAC_KEY` | Original, com cuidado | ADAPTAR | Trocar sem medir o `.env` derrubaria a entrada de mensagens; produção mantém o nome antigo até o passo manual | #2268, #2425 | Alto se feito sem o passo manual |
| Assumir interrompe turno autônomo | Turno em voo saía por cima | Revogação canônica | Original | ADAPTAR | Sem a suspensão de empresa; consumidor `turn_discarded` portado | #2277, #2541 | Médio |
| Uma conferência por corte no envio | Duas leituras REST por bolha | Uma | Original + fork | ADAPTAR | A economia não pula a conferência de etapa do fork | #2338 | Baixo |
| Seleção de modelo / par provedor | Anthropic via Gateway | Régua do par, reserva de assinatura | Fork (para nossa instalação) | ADIAR | Conserta cenário OpenAI+Claude que não existe aqui; reescreve o núcleo de seleção sobre cadeias não portadas | #2385, #2118, #2507 | — |
| Retenção de mídia opt-in | Sem interruptor | Interruptor + marcador | Original | ADIAR | Rota de retenção divergiu; apaga mídia (LGPD) — porte dedicado | #2180, #2309, #2466, #2140 | — |
| Lead nasce pelo celular | Só ao receber | Também ao enviar pelo celular | **Decisão do dono** | ADIAR | Abriria card comercial para pais/alunos contatados pela secretaria | #2543 | — |
| Meet com acesso aberto | — | Escopo OAuth novo | **Decisão do dono** | ADIAR | Reautorização e possível nova verificação do app Google | #2089 | — |
| Jev, propostas, Portugal/RGPD, grupos, B2B, cobrança, voz, Meta oficial | — | Existem | — | NÃO SE APLICA / ADIAR | Recursos que a operação não usa ou cadeias inteiras não portadas | ver tabela | — |

## 5. Migrations

49 migrations novas na branch (`git diff --name-only --diff-filter=A origin/main..HEAD -- supabase/migrations`):

`0502 0503 0505 0507 0508 0509 0513 0514 0525 0527 0528 0529 0530 0532 0533 0535 0536 0537 0538 0539 0540 0542 0543 0545 0551 0553 0558 0577 0578 0581 0585 0586 0589 0590 0594 0595 0596 0597 0612 0615 0617 0621 0626 0627 0644 0645 0652 0654 0655`

**Adaptações necessárias** (todas conferidas com `ferramentas/checkobj.py`, que compara cada
função/policy criada ou derrubada com a definição vigente do fork):

| Migration | Adaptação |
|---|---|
| 0503 | Reescrita a partir da definição do fork: a do upstream citava coluna inexistente e apagaria da trava `sistema_escolar_tool_ids`, `can_mark_won`, `can_mark_lost` |
| 0507 | Era a 0521 do upstream; renumerada (a 0521 do fork é a proteção sob `ensure_rls`) |
| 0577 | Sem `contacts.is_personal` (conversa pessoal não portada): a função `language sql` quebraria a instalação |
| 0589 | CHECK de `agent_inbox_items.kind` = lista do fork + `canal_pausado` (o upstream somava 8 tipos de cadeias não portadas) |
| 0645 | `fn_comando_da_conversa` chamada com 6 argumentos (assinatura do fork; o 7º, `is_group`, é da cadeia de grupos) |
| 0655 | **Própria do fork**: seção G da 0501 do upstream — `turn_discarded` só pelo servidor — sem a suspensão |

**Achado da validação**: o `pnpm test:db` encontrou sete blocos do `baseline.sql` que vieram de
carona em resoluções automáticas da cauda do arquivo, sem migration correspondente no fork (Jev
0547, conversões 0524, retenção da IA 0587, prospecção 0506, origem do negócio 0531, pedidos de
plataforma 0623, comanda 0582) e a chave do MCP externo. O primeiro quebrava a instalação limpa
(`relation "public.jev_observacoes" does not exist`). Todos removidos; o bloco final de proteção
(`fn_proteger_tabelas_sob_ensure_rls`) foi recolocado como último.

**Riscos e procedimento de implantação**: ver seção 8. Nenhuma migration foi aplicada em produção.
O caminho do fork é o de sempre: `scripts/deploy-vps.sh` aplica a cadeia; as migrations são
idempotentes (`if not exists`, `create or replace`, `drop ... if exists`).

## 6. Testes

PENDENTE_TESTES

## 7. Tabela completa (443 PRs funcionais)

Decisões: **PORTAR (limpo)** = cherry-pick sem conflito, testes do PR verdes; **ADAPTAR** =
cherry-pick com mudança descrita; **ADIAR** = motivo e dependência na coluna; **NÃO SE APLICA** =
recurso que a operação não usa (Jev, cobrança, propostas, Portugal, grupos, voz, Meta oficial, kit
genérico, governança do upstream). O commit no fork leva `(cherry picked from commit …)`.

| PR | Versão | Título | Decisão | Justificativa / adaptação | Commit no fork | Migrations |
|---|---|---|---|---|---|---|
| #2058 | v1.70.0 | fix(agenda): o calendário de marcação não abre mais num mês que acabou | PORTAR (limpo) |  | 8ca8e2538 | — |
| #1978 | v1.70.0 | fix(hooks): população de migrations em arquivo — o hook não termina com 12 mil refs | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #1987 | v1.70.0 | fix(suspensão): suspender uma empresa passa a calar a IA, os envios e a API dela | ADIAR | suspensão de empresa (261 arquivos, 0501) — instalação de uma empresa só; recurso de revendedor multi-tenant, alto risco de conflito sem uso | — | 0501 |
| #2071 | v1.70.0 | ci(e2e): cacheia os .deb do --with-deps — o espelho do apt deixa de comer o teto das partes | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2069 | v1.70.0 | docs(deploy-selfhost): receita do agent_worker concede default privileges p/ migrations futuras | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2055 | v1.70.0 | fix(ui): DialogContent base ganha teto de altura — conteúdo rola por dentro (#2044) | PORTAR (limpo) |  | f5f2583da | — |
| #2054 | v1.70.0 | feat(canal): "digitando…" também no número oficial (Cloud API) | NÃO SE APLICA | canal oficial/intermediado/Graph — não usamos (só WAHA) | — | — |
| #2039 | v1.70.0 | fix(agente): o fechamento do turno fora do contrato pede UMA correção antes de a fila repetir o turno inteiro | PORTAR (limpo) |  | e878afdea | — |
| #2082 | v1.70.0 | fix(agent-engine): classifica a transcrição de áudio no roteador de intenções | ADAPTAR | conflito com o Jev (não portado): mantido o resto do fork; sem signalBody/consulta ao Jev; testes do Jev removidos, o do sinal digitado mantido | 45fe7b454 | — |
| #2050 | v1.70.0 | fix(handoff): quem começa a resposta com "parar" recebe a confirmação de saída, não o texto de atendente | PORTAR (limpo) |  | e013f678b | — |
| #2026 | v1.70.0 | fix(escalacao): frases da passagem para humano sem travessão (issue #1881) | PORTAR (limpo) |  | a7b65e367 | — |
| #2038 | v1.70.0 | perf(llm): com Anthropic, os passos do laço de ferramentas leem do cache o que o passo anterior já mandou | PORTAR (limpo) |  | c6818c605 | — |
| #2107 | v1.70.0 | fix(followup): a varredura de silêncio não tenta inscrever, a cada minuto, quem já tem follow-up vivo | ADAPTAR | o fork não tem cooldown nem retorno-vivo (#1729 adiado): só a leitura de inscrição viva entrou; testes de cooldown/retorno (deletados no fork) seguem fora | 90b121018 | — |
| #2040 | v1.70.0 | fix(i18n): o próximo passo que o sistema grava na demanda nova aparece no idioma de quem lê | PORTAR (limpo) |  | 3cdae70d6 | — |
| #2060 | v1.70.0 | feat(inbox): transcrição do áudio aparece no balão da conversa (#2057) | PORTAR (limpo) |  | 4b27356b8 | — |
| #2072 | v1.70.0 | fix(onboarding): boas-vindas gravam na organização da aba, não na ativa | PORTAR (limpo) |  | e7e5479ab | — |
| #2031 | v1.70.0 | fix(ia): retenção, escalação e approved-reply usam a janela de RESPOSTA pelo tipo | PORTAR (limpo) |  | 258f41763 | — |
| #2083 | v1.70.0 | test(lgpd): módulo que cria tabela com dado pessoal precisa declarar a seção | NÃO SE APLICA | teste de seção LGPD de módulo (ADR-0002) — não temos módulos com dados | — | — |
| #2088 | v1.70.0 | docs(skill): adiciona guia de operação diária pela interface | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2023 | v1.70.0 | feat(webhooks): a assinatura da fonte de captação se liga pela tela | ADAPTAR | e2e.yml: mantida a divisão de partes do fork (sem a parte 6 do upstream); a spec nova entrou na SPECS_PARTE_5 | 79bd33545 | — |
| #2085 | v1.70.0 | feat(ia): o cartão do Jev exibe o aviso da área da saúde (DEC-012 #2) | NÃO SE APLICA | Jev (serviço externo) — não habilitado no fork | — | — |
| #2033 | v1.70.0 | test(kit): fecha a intermitência da #1570 — asserções grep -q leem por here-string (SIGPIPE sob pipefail), de  | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2078 | v1.70.0 | fix(rls): platform admin support_readonly não escreve em organizations pelo PostgREST | ADAPTAR | teste org-suspensa removido (suspensão #1987 não portada); checkobj: 48 policies/1 função da 0508 idênticas ao upstream — nenhuma regra própria do fork sobrescrita | 81794106f | 0508 |
| #2030 | v1.70.0 | fix(workers): media-derive-worker não grava transcrição em mensagem já anonimizada (#1991) | PORTAR (limpo) |  | ab26be32a | — |
| #2037 | v1.70.0 | feat(followup): o gatilho de silêncio aceita um máximo, e a pausa de reentrada pode contar do último envio do  | ADIAR | depende do cooldown/reentrada da cadeia de roteiros (#1729, adiado): o fork não tem loadContactIdsEmCooldown | - | — |
| #1952 | v1.70.0 | AI: o chat de casos mostra trechos do acervo ligados à pergunta (parte da F3 da #1869) | PORTAR (limpo) |  | 6cf0752aa | — |
| #2024 | v1.70.0 | fix(leads): o comentário da timeline não promete valor anterior no api_audit_log (issue #1755) | PORTAR (limpo) |  | e6b870d0a | — |
| #2122 | v1.70.0 | fix(org-operante): empresas paradas saem no banco, antes do limit, sem lista de ids na URL (#2015) — trabalho  | ADIAR | depende da suspensão de empresa (#1987, adiado) — lib/organizacao/operante não existe no fork | - | — |
| #1963 | v1.70.0 | fix(ai): normalizar id do OpenRouter no custo e parar de contabilizar desconhecido como grátis (#1931) | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | — |
| #2011 | v1.70.0 | fix(agent): reverter, criar pela tela e a rota de versões levam todas as chaves de versionShapeSchema (#2004) | PORTAR (limpo) |  | d04ff959f | — |
| #2096 | v1.70.0 | fix(agente): leitura de JSON de auxiliares tolera cerca, prosa e repeticao (issue #2090) | ADAPTAR | IntentVerdict sem o campo 'falhou' (vem de PR não portado); teste ajustado à forma do fork | cc53ed8b0 | — |
| #2051 | v1.70.0 | fix(webhooks): o formulário do Elementor Pro passa a criar lead; campos do formulário nas mensagens | ADAPTAR | template.ts sem marcacaoDoCrm (modelos de mensagem #1673 não portado); dicionário e índice de arquitetura só com as entradas deste PR | e45d1e086 | — |
| #2012 | v1.70.0 | fix(api): teto de escrita nas 4 rotas Bearer sem limitador | ADAPTAR | rotas de rascunho sugerido e anexo em nota não existem no fork; piso de vacuidade da cerca = 5 rotas Bearer do fork | 0fac5001e | — |
| #2101 | v1.70.0 | fix(lgpd): o prazo da solicitação sai no dia certo, e nao vence adiantado | PORTAR (limpo) |  | 2cb9d1074 | — |
| #2028 | v1.70.0 | feat(api): aceita token dsk_ nas rotas de configuração de IA, follow-up e agenda (#1875) | PORTAR (limpo) |  | 0b1585474 | — |
| #2020 | v1.70.0 | fix(lgpd): export do titular traz a transcrição da mídia (media_derived_text) | ADAPTAR | partes de grupos do WhatsApp (não portados) fora do export, do PDF e dos testes; a transcrição nas mensagens do titular entrou | d1bb25158 | — |
| #2123 | v1.70.0 | fix(atendimento): revisão obsoleta em fn_service_status sai como PT409 — o laço de 40001 no Supabase self-host | ADAPTAR | baseline: apêndice 0514 depois do bloco da nossa 0521 (a chamada final da proteção segue sendo o último statement); fn_service_status sem personalização no fork | 0211d2d1c | 0514 |
| #2045 | v1.70.0 | test(inbox): o filtro de etiqueta não desmonta quando a organização pisca nula (#1336) | PORTAR (limpo) |  | 1f8766200 | — |
| #2125 | v1.70.0 | fix(db): fecha os avisos do Security Advisor (0521) | ADAPTAR | renumerada 0521→0507 (a 0521 do fork é a proteção sob ensure_rls, já aplicada); funções alteradas conferidas: corpos sem tabela sem schema; apêndice antes do bloco final do fork; linhas de carona 0500/0501 fora do MANIFEST | 95b4756fd | 0521 |
| #2081 | v1.70.0 | fix(followups): o dossiê distingue reenvio técnico de contato com o cliente | PORTAR (limpo) |  | 1fffacee7 | — |
| #2075 | v1.70.0 | fix(inbox): a bolinha do avatar diz em palavras quem está no comando | ADAPTAR | teste do upstream nascia na feature de grupos (#1647, não portada): trazida só a fixture e o bloco da bolinha; STATUS_ENCERRADOS exportado | f253e02b6 | — |
| #2084 | v1.70.0 | feat(legal): perfil de Portugal — NIF (mod-11), RGPD e feriados nacionais | NÃO SE APLICA | perfil jurídico de Portugal/RGPD — operação é Brasil | — | — |
| #2019 | v1.70.0 | fix(auth): /account-suspended sai de PUBLIC_PATHS para o proxy renovar a sessão | NÃO SE APLICA | o fork não tem /account-suspended em PUBLIC_PATHS (sem suspensão de empresa, #1987) — nada a corrigir | - | — |
| #2076 | v1.70.0 | feat(conversoes): venda de quem veio de anúncio da Meta pela página vai ao pixel, com o valor lido da conversa | ADIAR | conversões de anúncio (Meta pixel) — cadeia #1566/#1789 não portada; decisão de produto pendente (usuário perguntou por Meta/Google) | — | — |
| #2010 | v1.70.0 | feat(ia): confira promessas com evidências comerciais consultadas | ADAPTAR | mapa agent-turn: só a aresta deste PR (as do Jev ficam fora) | 2dd9f31e0 | — |
| #1711 | v1.70.0 | Roteamento: modo load por menor carga + nome nas tools MCP (fatia 12a da #1539) | PORTAR (limpo) |  | 6523ea8ce | — |
| #2136 | v1.70.0 | fix(webhooks): fonte de captação com assinatura só aceita envio conferido | PORTAR (limpo) |  | dd8e214f2 | — |
| #2005 | v1.70.0 | fix(escalacao): o prazo do silêncio por atendimento manual passa a ser configurável por instalação | ADAPTAR | mapa escalacao-ciclo-humano: só a mudança deste PR (sem as arestas do Jev) | dd4fcfcd7 | — |
| #2027 | v1.70.0 | refactor(auth): uma única função decide se admin de plataforma pode escrever na empresa | ADIAR | depende de platform_admin_scope no AuthUser (#1987, não portado); a garantia no banco (0508, support_readonly não escreve pelo PostgREST) já entrou | - | — |
| #2079 | v1.70.0 | feat(messaging): assina as mensagens enviadas ao cliente com o nome de quem fala (atendente ou IA) em negrito  | ADIAR | assinatura com nome do atendente — depende de "recursos opcionais" (#1876, adiado) e altera o texto enviado ao aluno | — | — |
| #2148 | v1.70.0 | test(cercas): o teto de escrita cobra o par chamada+return, não o nome das variáveis | PORTAR (limpo) |  | 9ab93d143 | — |
| #2137 | v1.70.0 | fix(db): a auditoria é só-inclusão para todo papel, e o prelude do self-host volta a aplicar o baseline | ADAPTAR | apêndice 0525 antes do bloco final do fork; README de deploy: só a linha de revoke deste PR | 1b4df2b9e | 0525 |
| #2145 | v1.70.0 | fix(ai): aplicar uma proposta não perde mais onze chaves da versão | ADAPTAR | fica a versão do upstream (versionPayloadFrom do fork): corrige furo do fork em que o acadêmico virava comercial ao aplicar proposta; teste próprio do escopo acadêmico, sabotado 1/9 | 33c01b09b | — |
| #2153 | v1.70.0 | fix(kit): aplica os modelos de e-mail do GoTrue na instalação single-server | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2144 | v1.70.0 | fix(agent-engine): o JSON de modelo não quebra mais quando o modelo repete o objeto | ADAPTAR | sem o campo 'falhou' do upstream: sem veredito = clean() (fail-open do fork, inalterado); teste ajustado | 1bb968db7 | — |
| #2143 | v1.70.0 | fix(onboarding): boas-vindas não renomeiam organização já configurada | PORTAR (limpo) |  | 781693d06 | — |
| #2049 | v1.70.0 | fix(opt-out): quem responde PARAR tem o negócio aberto fechado como perdido | PORTAR (limpo) |  | ca1ac286d | 0513 |
| #2013 | v1.70.0 | fix(db): a trava de imutabilidade da versão publicada cobre proposal_ai_draft_enabled e inbound_debounce_ms | ADAPTAR | 0503 reescrita a partir da definição do fork: sem proposal_ai_draft_enabled (coluna inexistente), preservadas as colunas do Sistema Escolar e ganho/perda, + inbound_debounce_ms, service_scope e can_update_lead_state; invariante adaptado e sabotado | 6cdd1e658 | 0503 |
| #2149 | v1.70.0 | infra(migrations): a descrição de migration mora no próprio .sql — o MANIFEST para de conflitar | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2151 | v1.70.0 | fix(crm): a ficha envia só as chaves de custom_fields que a pessoa alterou | PORTAR (limpo) |  | 4c475b71c | — |
| #2157 | v1.70.0 | docs(skill): o gate jurídico G4 só roda no worker legado, e uma cerca diz isso | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2154 | v1.70.0 | fix(inbox): mostra a transcrição do áudio no balão, inclusive enquanto ela é gerada (#2133) | ADAPTAR |  dicionário: só as chaves deste PR; | 3dfc1cbde | — |
| #2152 | v1.70.0 | fix(onboarding): envio das boas-vindas de org ja configurada sai para /app/inbox em vez de db_error | PORTAR (limpo) |  | d43905f57 | — |
| #2009 | v1.70.0 | fix(leads): duas anotações ao mesmo tempo no mesmo negócio não se apagam | PORTAR (limpo) |  | c4d31f57c | 0502 |
| #2048 | v1.70.0 | feat(prospecting): operador escolhe quais empresas entram na fila (#1896) | NÃO SE APLICA | prospecção — módulo que não usamos | — | 0506 |
| #2043 | v1.70.0 | fix(zernio): o pino que chegou sem coordenadas é buscado de novo, sozinho | NÃO SE APLICA | redes sociais/Zernio — canal que não usamos | — | 0504 |
| #2080 | v1.70.0 | fix(rls): nota interna deixa de ser editada/apagada por colega — só o autor ou manager+ (#1870) | PORTAR (limpo) |  | 0bd361350 | 0509 |
| #2150 | v1.70.0 | fix(installer): single-server atrás de Traefik/NPM próprio preserva REVERSE_PROXY e aplica o overlay do proxy | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2091 | v1.70.0 | Extensão declarativa pode contribuir um tema (gancho) — #1095 | NÃO SE APLICA | extensão declarativa de tema — extensões não são usadas | — | 0520 |
| #2159 | v1.70.0 | fix(money): comandas e filtros não somam moedas diferentes (#1531) | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | — |
| #2161 | v1.70.0 | Refs #1532: deixa a janela de esfriando da etapa editavel (parte 1, sem migration) | ADAPTAR | lista de colunas da etapa = a do fork (service_policy, exit_locked) + expected_duration_hours | a8cb524f9 | — |
| #2167 | v1.70.0 | fix(auth): mudar a exigência de MFA da empresa cobra o fator provado na sessão | PORTAR (limpo) |  | 43d73cd08 | — |
| #2162 | v1.70.0 | fix(automacao): aceita tag_added de negocio em outro funil na acao de mover (#2155) | PORTAR (limpo) |  | e4d206a8a | — |
| #2087 | v1.70.0 | feat(conversoes): cada etapa do funil pode avisar a Meta, não só a venda | ADIAR | conversões por etapa (Meta) — cadeia de conversões não portada | — | 0524 |
| #2163 | v1.70.0 | feat(auth): exige segundo fator por nivel minimo de papel (#1533) | PORTAR (limpo) |  | 7bd0dfa70 | — |
| #2168 | v1.70.0 | fix(lgpd): o painel da plataforma le o prazo como dia, e os dois selos viram juntos | PORTAR (limpo) |  | 35178a479 | — |
| #2169 | v1.70.0 | fix(lgpd): o prazo nas telas de detalhe, e a ultima hora do dia do prazo deixa de contradizer o selo | PORTAR (limpo) |  | 743b01b06 | — |
| #2170 | v1.70.0 | fix(lgpd): a barra do prazo das telas de detalhe conta ate o fim do dia | PORTAR (limpo) |  | afdaec80d | — |
| #2172 | v1.70.0 | fix(pipelines): escape descarta o rascunho de nome e de chance da etapa (#2164) | PORTAR (limpo) |  | 937bb5d28 | — |
| #2174 | v1.70.0 | Prospecção: provedor plugável escolhido por organização (F1 + F2 + F5) | NÃO SE APLICA | prospecção — módulo que não usamos | — | — |
| #2104 | v1.70.0 | feat(prospecting): ajusta o limite por dia e o intervalo de uma campanha pausada (#2095) | NÃO SE APLICA | prospecção — módulo que não usamos | — | — |
| #2173 | v1.70.0 | fix(comandas): a comanda nasce na moeda da organizacao (#2160) | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | — |
| #2175 | v1.70.0 | fix(mcp): leitura do contato do turno fica escopada na conversa de atendimento (#2158) | PORTAR (limpo) |  | c848aded1 | — |
| #2105 | v1.70.0 | feat(prospecting): a empresa entra no funil só quando for abordada (funnel_entry) | NÃO SE APLICA | prospecção — módulo que não usamos | — | — |
| #2176 | v1.70.0 | fix(lgpd): a coluna Vence em da lista da organizacao mede ate o fim do dia | PORTAR (limpo) |  | ed398e8f8 | — |
| #2177 | v1.70.0 | feat(i18n): inglês entra como idioma em construção, com o catálogo inteiro | NÃO SE APLICA | inglês como idioma em construção — operação é pt-BR | — | — |
| #2106 | v1.70.0 | feat(prospecting): marcar, desmarcar e excluir empresas da fila de uma campanha pausada | NÃO SE APLICA | prospecção — módulo que não usamos | — | — |
| #2179 | v1.70.0 | fix(lgpd): o KPI e o alerta do painel contam a janela ate o fim do dia | PORTAR (limpo) |  | efb41b66d | — |
| #2182 | v1.70.0 | Escopo do contato do turno nas outras leituras do Atender (conversas, histórico, pedidos) | PORTAR (limpo) |  | 6175c3d26 | — |
| #2181 | v1.70.0 | feat(followup): nós de mover lead e editar tag no fluxo de follow-up (#2065) | ADIAR | nós de mover lead/editar tag no construtor de follow-up: conflita no construtor inteiro (sem os nós da cadeia de roteiros) e mover lead por automação precisa passar pela trava de saída — porte dedicado; follow-up desligado no fork | - | — |
| #2186 | v1.70.0 | fix(sentry): o replay passa pelo mesmo scrub de URL do resto da telemetria | ADAPTAR | mantidos os sentryScrubHooks do fork (Sentry 11/privacidade #1746 não portado); o replay com scrub de URL entra | 05ee86c27 | — |
| #2185 | v1.70.0 | fix(central): o aviso de midia nao lida passa a ser unico por organizacao aberta | ADAPTAR |  baseline: apêndice antes do bloco final do fork, objetos conferidos (checkobj sem divergência); | 05129f246 | 0527 |
| #2187 | v1.70.0 | fix(fuso): Roma entra, e toda tela de fuso oferece a mesma lista | ADAPTAR |  mapa en.json: só a mudança deste PR aplicada sobre o do fork; | eca9be0b1 | — |
| #2189 | v1.70.0 | fix(media): a transcrição usa o modelo da organização quando ele entende áudio e nunca deixa o status nulo (#2 | ADAPTAR | sem o pulo de grupo (grupos não portados); entra o status 'failed' quando o pedido de derivação não sai; testes sem baseUrl (provedor personalizado não portado) e sem o caso de is_group | 448f18639 | — |
| #2191 | v1.70.0 | fix(lgpd): workers de mídia e clima não regravam mensagem anonimizada | ADAPTAR | worker de clima do upstream reescrito em torno do Jev: mantido o do fork + a guarda LGPD deste PR aplicada à mão; teste próprio tests/unit/ai-sentiment-worker-lgpd.test.ts (sabotado: 1/2 vermelho) | 66b43d183 | — |
| #2192 | v1.70.0 | fix(agenda): o porteiro do envio deixa de comparar meeting_request_id nulo com igual | PORTAR (limpo) |  | a6f0c0944 | 0528 |
| #2193 | v1.70.0 | fix(rls): support_readonly deixa de escrever nas 11 policies da prioridade 1-4 do #2115 | PORTAR (limpo) |  | 737fc6683 | 0529 |
| #2198 | v1.70.0 | test(lgpd): a catraca do #2100 cobre lib/mcp/tools e a leitura do prazo é provada nos três fusos | PORTAR (limpo) |  | 37eeddba8 | — |
| #2197 | v1.70.0 | fix(conversoes): o Purchase clique-para-WhatsApp leva Page id ou WABA (issue #2098) | ADIAR | conversões (Purchase CTWA) — cadeia de conversões não portada | — | — |
| #2199 | v1.70.0 | fix(canais): o negócio diz por onde o cliente chegou (Instagram e Facebook não viram WhatsApp) | NÃO SE APLICA | redes sociais/Zernio — canal que não usamos | — | 0531 |
| #2196 | v1.70.0 | fix(rls): o botao de anonimizar exige platform admin full (#2195) | PORTAR (limpo) |  | be015879d | 0532 |
| #2201 | v1.70.0 | test(invariants): varreduras de RLS, security definer e cascata de LGPD com módulo instalado (3ª alínea da D8) | PORTAR (limpo) |  | e4b279a23 | — |
| #2200 | v1.70.0 | fix(inbox): o vazio da aba Grupos diz onde ligar um grupo (#2103) | NÃO SE APLICA | aba Grupos — grupos na inbox (#1647) não portado; nossa regra pula grupo | — | — |
| #2203 | v1.70.0 | fix(skills): skill de .zip edita o texto na UI herdando references/ e assets | PORTAR (limpo) |  | 89914cabb | — |
| #2202 | v1.70.0 | fix(rls): support_readonly deixa de escrever nas 36 restantes da #2115 (0533) | ADAPTAR | sem fn_honorarios_provisionar (módulo honorários não existe no fork) na migration, no baseline e no invariante (30 policies em vez de 36); demais 63 policies conferidas sem divergência | f1a4209fa | 0533 |
| #2205 | v1.71.0 | fix(ia): a tela de IA anuncia a escada de transcrição, não mais whisper-1 fixo | ADAPTAR | teste i18n-provedores-e-pontos não existe no fork (foi apagado antes); o resto entra | 6bb4609af | — |
| #2207 | v1.71.0 | feat(kanban): ação "Abrir conversa" no card do funil e no dossiê do lead | PORTAR (limpo) |  | 4c9082911 | — |
| #2208 | v1.71.0 | fix(kit): preflight, portão do build local e rollback no update (#1955) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2212 | v1.71.0 | chore(deps): bump actions/cache from 4 to 6 | NÃO SE APLICA | bump de action do CI do upstream | — | — |
| #2214 | v1.71.0 | chore(deps): fecha os alertas do Dependabot de 03/10 (undici, ip-address, fast-uri, brace-expansion) | PORTAR (limpo) |  | 4907f6848 | — |
| #2211 | v1.71.0 | 💡 Webhook de saída: gatilhos de ganho, perda, reabertura e troca de responsável (fatia da proposta de #1528) | ADIAR | webhook de saída para ganho/perda/reabertura/responsável — construído sobre o responsável-no-corpo do #1612/#1709 (adiados na v1.69) e sobre a ação criar tarefa (#1540); porte em cadeia | - | 0534 |
| #2215 | v1.71.0 | feat(kit): caminho declarado da CA do Supabase no runtime e nos psql efêmeros (#829) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2217 | v1.71.0 | Derivação que conclui depois do handoff devolve a conversa e corrige o motivo gravado (#2210) | PORTAR (limpo) |  | 15e66ff8f | — |
| #2216 | v1.71.0 | feat(agent): sentiment threshold configurable and prompt without e-commerce presumption | ADAPTAR | rota do Jev fora; o worker do fork passa a ler DEFAULT_SENTIMENT_THRESHOLD do mesmo módulo do schema (um 0.3 só) | 6aec1886e | — |
| #2218 | v1.71.0 | 💡 Negócio aberto duplicado: aviso sem bloqueio na tela e na API (#1751) | PORTAR (limpo) |  | 5a390d907 | — |
| #2222 | v1.71.0 | feat(metrics): análise do funil — conversão por etapa, dias até fechar e ganho × perda por origem (rota) | PORTAR (limpo) |  | 773aaac58 | — |
| #2221 | v1.71.0 | Taxa histórica de ganho por etapa: contagem + sugestão na tela do gestor (#1753) | ADAPTAR | dublê de etapas: só o filtro de intervalo deste PR (o .or() veio de PR não portado) | d5846075f | — |
| #2224 | v1.71.0 | test(skills): spec de render do estado versão nova do catálogo (Refs #1975) | PORTAR (limpo) |  | c6df71063 | — |
| #2226 | v1.71.0 | Lembrete de véspera (1440) não dispara na hora nem em duplicidade — Refs 2223 | ADAPTAR | consulta do lembrete com created_at e sem o join de status da org (suspensão não portada); trechos de org não operante fora | 9335a1272 | — |
| #2227 | v1.71.0 | fix(retencao): o trace grava se o envio vetado era resposta ou disparo (Refs 2112) | ADAPTAR | vocabulário: só a entrada tipo_envio deste PR (a de suspended_kind é da suspensão, não portada); apêndice 0535 antes do bloco final | 5df516b70 | 0535 |
| #2238 | v1.71.0 | fix(conhecimento): acervo nomeia a FK da versão publicada e lê o erro (#2236) | ADAPTAR | mantido o cálculo da chave de embedding do fork (#1864 não portado); a lista de agentes passa pelo helper com a FK nomeada | 2677d848a | — |
| #2242 | v1.71.0 | ci: o typecheck ganha 6 GB de heap (estourava no teto de ~4 GB) | PORTAR (limpo) |  | 1785e0843 | — |
| #2239 | v1.71.0 | fix(agenda-lembrete): a remarcação reposiciona a régua do degrau vencido (#2230) | ADAPTAR | consulta do lembrete com starts_at_marked_at e sem o join de status da org; apêndice 0536 conferido (fn sem divergência) | 46f32fdf4 | 0536 |
| #2244 | v1.71.0 | fix(agenda): a recusa de envio para de citar link inexistente em compromisso sem Meet | PORTAR (limpo) |  | 0db3d3b77 | — |
| #2241 | v1.71.0 | feat(marca): permitir CSS personalizado e exibir marca no login | ADIAR | CSS personalizado de marca + marca no login (33 arquivos, mexe no proxy.ts) — porte dedicado com revisão de XSS | — | — |
| #2246 | v1.71.0 | fix(pedidos): pedido de parar de receber dito em áudio abre o aviso na Central (#2233) | NÃO SE APLICA | construído sobre lib/ai/decisao/pedidos (pedidos percebidos pelo Jev, #1747 — não aplicável); o opt-out por texto do fork continua em lib/opt-out/deteccao.ts | - | — |
| #2245 | v1.71.0 | fix(mcp): IA confere o que o cliente disse antes de gravar campo personalizado (#2234) | ADIAR | conferência de campo personalizado amarrada à tarefa do Jev (lib/ai/decisao); o degrau 1 (conferência em código, sem rede) é aproveitável num porte dedicado | - | — |
| #2248 | v1.72.0 | fix(jev): a escala do Jev separa relato de reclamação e a concordância usa o limiar por agente | NÃO SE APLICA | Jev (serviço externo) — não habilitado no fork | — | — |
| #2249 | v1.72.0 | fix(agenda-lembrete): remarcar para mais longe rearma o degrau da data nova (#2243) | ADAPTAR | consulta com reminder_sent_at e sem o join de status da org (suspensão não portada) | a2f66686b | — |
| #2250 | v1.72.0 | fix(baseline): as recriações transitórias (trigger e anon) deixam de ser reaplicadas a cada update | PORTAR (limpo) |  | a8551fd51 | — |
| #2254 | v1.72.0 | fix(agent-preview): Testar mostra a resposta fora do horário de envio (substitui #2252, de @leadframeassessori | PORTAR (limpo) |  | a54e21f14 | — |
| #2253 | v1.72.0 | fix(baseline): a cerca vê revoke sem 'table', e o TRUNCATE do anon acompanha a concessão (#2251) | PORTAR (limpo) |  | 2fa2c1f01 | — |
| #2256 | v1.72.0 | fix(baseline): a função intermediária não enfraquece guarda forte — o portão antigo da #2196 sai de todas as p | PORTAR (limpo) |  | c96d6c832 | — |
| #2257 | v1.72.0 | fix(baseline): a cerca lê o grant citado em comentário, e as janelas de ai_budgets e api_audit_log fecham (#22 | PORTAR (limpo) |  | da807ca61 | — |
| #2259 | v1.72.0 | fix(baseline): fecha as pontas da cerca de concessões — service_role, TRUNCATE de ai_budgets e re-grant (#2258 | PORTAR (limpo) |  | 17db0ae09 | 0537 |
| #2260 | v1.72.0 | fix(central): a resposta a caso obsoleto não abre em dobro — índice único + savepoint no caminho transacional  | ADAPTAR |  baseline: apêndice antes do bloco final do fork, objetos conferidos (checkobj sem divergência); | 70ac500aa | 0538 |
| #2261 | v1.72.0 | fix(followup): o turno já enfileirado não sai depois de o fluxo ser apagado — a inscrição tem de estar viva an | ADAPTAR | testes de modelo aprovado/Jev/suspensão não existem no fork; o dublê do teste novo responde o corte de envio do follow-up (0403 do fork) como autorizado | 259547f1c | — |
| #2263 | v1.72.0 | fix(central): os avisos other por título não abrem em dobro — índice único parcial com o ref_kind como discrim | ADAPTAR | aviso do Jev fora; 0539 resolve duplicatas (não apaga); invariantes usam o aviso 'other' do laço do event_log no lugar do aviso do Jev | c17a8f325 | 0539 |
| #2264 | v1.72.0 | fix(triagem): o complemento reconhece a descrição no cabeçalho '-- manifest:' da migration | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2265 | v1.72.0 | fix(central): os avisos de orçamento não abrem em dobro — a última família da #880 (índice por (organização, k | ADAPTAR |  baseline: apêndice antes do bloco final do fork, objetos conferidos (checkobj sem divergência); | c39867612 | 0540 |
| #2266 | v1.72.0 | fix(ia): o on conflict do orçamento não depende do índice existir, e o log distingue "já aberto" (#2265) | PORTAR (limpo) |  | c878ccf7d | — |
| #2267 | v1.72.0 | test(health): prova a ausência da ida à rede pelo fetch, não pelo relógio | PORTAR (limpo) |  | 1e87e22f6 | — |
| #2270 | v1.72.0 | fix(propostas): esconde o link de modelos e trata o 404 com as propostas desligadas (#1889) | NÃO SE APLICA | propostas comerciais — módulo não portado | — | — |
| #2271 | v1.72.0 | fix(mcp): escopo do contato do turno nas leituras que faltaram e o filtro na consulta (#2184) | ADAPTAR | filtro de contato na consulta entra; filtro de grupo e ferramentas de rascunho/honorários (não portados) ficam fora, inclusive os testes de honorários | dec156e04 | — |
| #2272 | v1.72.0 | fix(leads): F1 lê e lista os contatos relacionados do negócio (#1506) | PORTAR (limpo) |  | 766108064 | — |
| #2273 | v1.72.0 | fix(b2b): consulta de CNPJ antes de criar, edição e exclusão segura de empresas (#1937) | NÃO SE APLICA | B2B/empresas/CNPJ — não é o caso da escola | — | — |
| #2275 | v1.72.0 | fix(ci): guarda de concurrency cobre todo job dos quatro workflows (1159) | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2274 | v1.72.0 | fix(mcp): escopo do turno nas duas leituras restantes | ADAPTAR | fork tem os modelos de mensagem anteriores ao #1673: entra só contatoDoNegocio e o escopo do turno na ferramenta | 26f568460 | — |
| #2278 | v1.72.0 | fix(testes): suíte roda com jsdom 30.1 e o pin em 30.0.1 sai do package.json (1745) | ADIAR | jsdom 30.1 — junto com o bump geral de dependências | — | — |
| #2276 | v1.72.0 | fix(mcp): escopo do turno nas leituras dos pacotes vender, reter e escalar | ADAPTAR | radar sem a parte de propostas (não portadas); ferramenta de modelo usa o leadId escopado, sem 'valores' (#1673); testes de propostas fora | 7c3433864 | — |
| #2277 | v1.72.0 | fix(followup): o turno descartado durante a pausa deixa rastro e é reenfileirado na retomada (#2262) | ADAPTAR | consumidor de turn_discarded portado antes (commit próprio, 0501 §C0a/§G sem suspensão); frase do dossiê sem a 'conta suspensa' (o fork não tem suspensão) — genérica para outros motivos, com espanhol; testes sem inglês (sem en.json); mock do teste com o corte  | cb703c26d | — |
| #2279 | v1.72.0 | fix(scheduler): a falha de um cron do scheduler deixa de sumir — o log diz a rota e o que conferir (1109) | PORTAR (limpo) |  | c7deeff7b | — |
| #2282 | v1.72.0 | fix(mcp): escopo do turno nas escritas por identificador | PORTAR (limpo) |  | a25ed592f | — |
| #2283 | v1.72.0 | fix(canais): o contato criado no app vira cadastro no CRM na coexistência (1632) | NÃO SE APLICA | canal oficial/intermediado/Graph — não usamos (só WAHA) | — | — |
| #2284 | v1.72.0 | fix(atendimento): aviso de fora do horário uma vez por contato por período fechado (1926) | ADAPTAR | teste de org parada (suspensão) não existe no fork. Junto, ajuste do teste do #2282 (escrita-do-turno-escopo): sem capacidades/propostas e sem as tools de rascunho e proposta, que o fork não tem | 51d10599d | — |
| #2285 | v1.72.0 | Relatórios: aba Por etiqueta consumindo GET /api/v1/reports/tags (1891) | ADIAR | aba Por etiqueta — depende do relatório por etiqueta (#1888, adiado) | — | — |
| #2287 | v1.73.0 | test(e2e): a aba Por etiqueta prova pela tela que o link abre o Inbox filtrado (#1891) | ADIAR | e2e da aba Por etiqueta — depende de #2285 | — | — |
| #2288 | v1.73.0 | fix(catalogo): a tela de Produtos edita o produto e a gravação manda só o que mudou (2135) | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | — |
| #2289 | v1.73.0 | fix(kit): single-server atrás de Traefik próprio publica as seis APIs do Supabase (2099) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2268 | v1.73.0 | fix(waha): webhook usa WHATSAPP_HOOK_HMAC_KEY, o nome exato da doc | ADAPTAR | prod compose mantém WHATSAPP_HOOK_HMAC (risco bad_signature); dev/local com _KEY; passo manual no relatório | 9101fd861+f4338b6dd | — |
| #1873 | v1.73.0 | fix(guardrails): a promessa de retorno humano não escapa mais reformulando a frase | PORTAR (limpo) |  | b38075d6a | — |
| #2290 | v1.73.0 | fix(router): a intenção do roteador leva o card ao funil de destino (#2155) | ADAPTAR | destino de funil só para contato em etapa comercial (resolve-turn-agent zera em humano/terminal/acadêmico e quando a intenção era do agente acadêmico); inbound-turn só move com agente comercial + can_update_lead_state; transfereParaOFunil recusa origem exit_lo | 34ed44349 | 0542 |
| #2291 | v1.73.0 | fix(ci): a mensagem do gate do CHANGELOG para de culpar o autor do PR | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2292 | v1.73.0 | fix(leads): audit de lead.updated grava antes/depois só dos campos tipados sem PII (1755) | PORTAR (limpo) |  | 855d65893 | — |
| #2293 | v1.73.0 | fix(contacts): o diálogo "Excluir contato?" avisa do compromisso na Agenda antes do clique (#1925) | PORTAR (limpo) |  | 168c76dcb | — |
| #2225 | v1.73.0 | feat(relatorios): tempo na etapa lê stage_changed_at, nunca última atividade (#2032) | PORTAR (limpo) |  | 3517b577e | — |
| #2056 | v1.73.0 | fix(radar): item sem próximo passo vira link e o caso cancelado marca o próximo passo da demanda (#2035) | ADAPTAR | RiskRadarList.test.tsx segue apagado no fork; 0505 conferida no checkobj (1 função, 0 divergências) | feca1d15e | 0505 |
| #2240 | v1.73.0 | fix(ia): a rota do Testar lê knowledge_source_ids dos materiais (#2237) | ADAPTAR | teste do fork (prior_turns) mantido ao lado do novo do upstream | 5ae7b0c25 | — |
| #2295 | v1.73.0 | fix(leads): a criação direta numa etapa exigente passa pela régua de campos (1710) | PORTAR (limpo) |  | 6005ccceb | — |
| #2296 | v1.73.0 | fix(agents): criar agente legado nasce mcp_agent + v1, nunca rag_bot mudo | PORTAR (limpo) |  | 7264133c3 | — |
| #2300 | v1.73.0 | test(hooks): o merge da main e a criação de migration nas duas metades, num só arquivo (Closes #374) | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2299 | v1.73.0 | fix(voz): bloqueado na ligação é recusado | NÃO SE APLICA | voz/telefonia — canal que não usamos | — | — |
| #2302 | v1.73.0 | Recusas da régua de campos obrigatórios que ninguém vê (#2297) | ADAPTAR | conferência de campos (#2234/#2245, depende do Jev, adiado) fora: conferencia-de-campos.ts e seu teste seguem fora; crm_create_lead NÃO ganha custom_fields (sem a conferência a IA gravaria campo que o cliente não disse) — teste de caminho 2 e criar-negocio-pel | a9ae473b9 | — |
| #2298 | v1.73.0 | test(i18n): a catraca enxerga chave montada em runtime e t() sobre variável | PORTAR (limpo) |  | a034c5606 | — |
| #2301 | v1.73.0 | fix(waha): o banco recusa nome de sessão acima do teto de 54 e a instalação antiga segue operando (#686) | PORTAR (limpo) |  | 3f6e5372f | 0543 |
| #2304 | v1.73.0 | fix(triagem): o complemento reconhece revoke all como revoke da função | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2308 | v1.74.0 | fix(leads): a régua da perda da origem pergunta antes de clonar na transferência de funil | PORTAR (limpo) |  | 0791dae45 | — |
| #2310 | v1.74.0 | fix(contatos): a busca por nome acha o contato acentuado, nos dois sentidos | PORTAR (limpo) |  | 33c146a37 | — |
| #2306 | v1.74.0 | test(invariantes): o gatilho da 0505 marca o próximo passo da demanda, provado no Postgres real (#2294) | PORTAR (limpo) |  | 7b61281d0 | — |
| #2319 | v1.74.0 | fix(999): a conexao do WhatsApp ganha a opcao de guardar o acervo do historico, desligada por padrao | ADIAR | acervo do histórico WAHA: reconvergência da sessão depende da cadeia de grupos na inbox (não portada; tipos de retorno divergem); opção desligada por padrão, o CRM não lê o histórico de volta e o acervo guarda PII fora do alcance da anonimização — porte dedica | - | — |
| #2134 | v1.74.0 | fix(roteador): o classificador nasce em "Automático" em vez de id fixo | PORTAR (limpo) |  | 8ac8f7c74 | 0530 |
| #2183 | v1.74.0 | fix(auth): o link de senha, convite e cadastro funciona para quem usa Hotmail e Outlook | PORTAR (limpo) |  | 34b447220 | — |
| #2321 | v1.74.0 | Feat/portao afirmacao clinica | NÃO SE APLICA | portão de afirmação clínica — nicho de saúde | — | — |
| #2323 | v1.74.0 | fix(ia): o portão clínico cobre espanhol e "não pode passar" deixa de ser prescrição (#2322) | NÃO SE APLICA | portão clínico em espanhol — nicho de saúde | — | — |
| #2324 | v1.74.0 | fix(retencao): a poda do arquivo de webhooks não manda id na URL | PORTAR (limpo) |  | 267691ddd | — |
| #2325 | v1.74.0 | fix(kit): o instalador diz onde configurar o envio de e-mail ao pular a Resend (#1110) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2138 | v1.74.0 | fix(catalogo): a tela de Produtos busca e pagina no catálogo inteiro | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | — |
| #2318 | v1.74.0 | feat(canais): desativado nunca entra na inbox — toggle por canal + quarentena | ADAPTAR | sem orgStatus/org_nao_operante (suspensão de empresa #1987 não portada) no gate, consultas, silence-sweep e testes; sem botão Grupos (cadeia de grupos não portada); allowPlatformAdmin 'leitura' → true (o fork não tem escopo de leitura no requireRole); proposta | a3f3518f8 | 0545 |
| #2061 | v1.74.0 | feat(ia): JEV roteia sozinho com reserva tradicional sob demanda | NÃO SE APLICA | Jev (serviço externo) — não habilitado no fork | — | 0547 |
| #2336 | v1.74.0 | fix(canais): a lista de canais de qualquer membro não leva a configuração interna do canal | PORTAR (limpo) |  | 0e7e7a2cc | — |
| #2339 | v1.74.0 | feat(legal): Portugal aparece no seletor de país, com a citação do RGPD revisada por IA (doc 88) | NÃO SE APLICA | perfil jurídico de Portugal/RGPD — operação é Brasil | — | — |
| #2351 | v1.74.0 | fix(rls): a leitura do catálogo não avalia a regra de escrita — destrava o e2e-parte (3) | PORTAR (limpo) |  | c727d1776 | 0553 |
| #2355 | v1.74.0 | fix(lgpd): o PDF imprime o CPF mascarado em vez de apontar para o data.json que o titular não recebe | NÃO SE APLICA | corrige o ramo 'CPF informado na conversa' do PDF LGPD, que o fork não tem (cadeia doc88/país não portada; o fork só imprime Armazenado/—) | - | — |
| #2350 | v1.74.0 | fix(llm): teto padrao de saida quando a org nao define um | PORTAR (limpo) |  | 5f72c18db | — |
| #2349 | v1.74.0 | fix(agenda): lembrete de véspera não sai no dia em que a reunião foi … | PORTAR (limpo) |  | 56701378a | — |
| #2332 | v1.74.0 | fix(agenda): toda agenda da rodada de sincronização carimba a própria leitura (#2314) | PORTAR (limpo) |  | e6af61132 | — |
| #2330 | v1.74.0 | fix(automacao): o aniversário e o compromisso alcançam a origem do atendimento (#2326) | ADAPTAR |  baseline: apêndice antes do bloco final do fork, objetos conferidos (checkobj sem divergência); | 101d07ad4 | 0551 |
| #2077 | v1.74.0 | fix(mcp): as ferramentas de marcação aceitam e repassam guest_email (#2062) | PORTAR (limpo) |  | 02bce9d70 | — |
| #2357 | v1.74.0 | feat(campanhas): {{lead.gancho}} e {{contato.link_previa}} na mensagem (#2311) | PORTAR (limpo) |  | 256140473 | — |
| #2359 | v1.74.0 | fix(templates): o papel agent lê as definições aprovadas do canal oficial (seletor da janela fechada deixa de  | NÃO SE APLICA | canal oficial/intermediado/Graph — não usamos (só WAHA) | — | — |
| #2354 | v1.74.0 | fix(lgpd): o PDF de acesso entrega o art. 15.º inteiro e o data.json a cópia completa do n.º 3 | NÃO SE APLICA | perfil jurídico de Portugal/RGPD — operação é Brasil | — | — |
| #2360 | v1.74.0 | fix(auth): aba numa organização e cookie em outra — aviso na leitura + recusa na escrita (#2335) | ADIAR | aba x cookie em organizações diferentes: só ocorre com usuário em 2+ organizações; o porte exige reescrever require-role sobre orgAtivaSemPortao/suspensão/platform_admin_scope (não portados) — candidato a porte dedicado se o fork passar a ter várias organizaçõ | - | — |
| #2362 | v1.74.0 | feat(redes-sociais): a conta conectada sai do atendimento ou se desconecta pela tela | NÃO SE APLICA | redes sociais/Zernio — canal que não usamos | — | — |
| #2365 | v1.74.0 | test(e2e): prazo explícito nas asserções da lista que dependem da recarga (suporte-temporario) | PORTAR (limpo) |  | 102665a19 | — |
| #2180 | v1.74.0 | feat(retencao): interruptor da limpeza de mídia antiga e aviso de mídia apagada na conversa (#1534) | ADIAR | retenção de mídia opt-in + marcador (0557): a rota data-retention do upstream acumulou podas não portadas (Jev, rascunhos 0419, golden 0428) e a poda nova é método próprio sobre ela; apaga mídia (LGPD) — porte dedicado, sem pressa (opt-in, desligado por padrão | - | 0557 |
| #2228 | v1.74.0 | Ação ai_decide opcional: a IA escolhe a ação-alvo e o motor executa (Refs 1970) | ADIAR | ação ai_decide de automação: schema depende do veto de laço #1528 e da ação create_task #1540 (não portados); passo sem tela (só API) — portar junto com essas cadeias se o dono quiser | - | — |
| #2194 | v1.74.0 | feat(api): configurar o agente por token de servidor (issue #2052) | PORTAR (limpo) |  | a58f8625c | — |
| #2280 | v1.74.0 | feat(mcp): coluna identificadora do cliente nas conexões de banco externo | ADAPTAR | en.json só com as chaves do banco externo (as do Jev/conferência e contas sociais ficam fora); operator-turn passa contactId: leadId (o contato do job, como no upstream) — sem isso o Operador não compilava com contactId obrigatório; view _safe do fork idêntica | d492a8b59 | 0558 |
| #2375 | v1.74.0 | fix(ia): versão do agente só referencia credencial e canal da própria empresa | PORTAR (limpo) |  | f398d986f | — |
| #2378 | v1.74.0 | fix(tokens): rótulos de config:write e role:admin dizem o poder inteiro | PORTAR (limpo) |  | 40e2464d4 | — |
| #1672 | v1.74.0 | feat(ia): queda da assinatura do ChatGPT para a chave de API como reserva (#1639) | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | — |
| #2380 | v1.74.0 | Contraste do chip de etiqueta vira contrato da régua (#2373) | PORTAR (limpo) |  | 3b271fb29 | — |
| #2385 | v1.75.0 | defaults: régua do par provedor-modelo recusa openai+claude e os defaults da Anthropic somem (#2377) | ADIAR | régua do par provedor-modelo (#2377): conserta instalação com provider openai + modelo claude, cenário que o fork (Anthropic) não tem; reescreve gateway-binding sobre cadeias não portadas (assinatura ChatGPT/reserva, baseUrl do provedor personalizado, catálogo | - | — |
| #2392 | v1.75.0 | agenda: invalid_grant com descrição junto vira reautenticar (#2384) | PORTAR (limpo) |  | 4dc14e2f9 | — |
| #2391 | v1.75.0 | feat(contatos): conversa pessoal sai da operação | ADIAR | conversa pessoal fora da operação (103 arquivos, 0563) — feature grande que toca escopos de IA; porte dedicado | — | 0563 |
| #2396 | v1.75.0 | fix(pessoal): marcar um contato como pessoal tira do RAG os trechos já ingeridos (#2394) | ADIAR | pessoal tira trechos do RAG — depende de #2391 | — | 0564 |
| #2398 | v1.75.0 | fix(inbox): rajada do realtime vira uma recarga e a conversa fora da aba atualiza; prazo explícito no e2e de e | PORTAR (limpo) |  | 3ac5e1eda | — |
| #2400 | v1.75.0 | fix(agenda): a recusa da renovação do Google diz o status HTTP e não vira “sem resposta” (#2393) | PORTAR (limpo) |  | 641a63895 | — |
| #2401 | v1.75.0 | fix(campanhas): o filtro de funil grande não estoura mais a URL da preparação (#2358) | ADAPTAR | sem .eq('kind','person') (contacts.kind é da cadeia de grupos, não portada) | c14249246 | — |
| #2403 | v1.75.0 | fix(campanhas): a consulta de ids de negócio pagina até o teto de 20.000 (#2402) | PORTAR (limpo) |  | 88aaafdde | — |
| #2405 | v1.75.0 | feat(conexoes): Pausar todas e Retomar todas em lote, com a conta no aviso | ADAPTAR |  dicionário: só as chaves deste PR; | 14f078ed1 | — |
| #2406 | v1.75.0 | fix(campanhas): a audiência pagina por keyset e a prévia avisa o teto (#2404) | ADAPTAR | sem o campo pessoal/is_personal (conversa pessoal #2391 adiada) | 15c205f6f | — |
| #2409 | v1.75.0 | test(campanhas): o keyset da audiência lê uma vez cada contato com created_at igual | PORTAR (limpo) |  | d908bc735 | — |
| #2407 | v1.75.0 | fix(empresas): mandar User-Agent na BrasilAPI, que recusa 403 sem ele | NÃO SE APLICA | B2B/empresas/CNPJ — não é o caso da escola | — | — |
| #2410 | v1.75.0 | fix(lgpd): os feriados portugueses do prazo são calculados, sem fim em 2030 (#2346) | NÃO SE APLICA | perfil jurídico de Portugal/RGPD — operação é Brasil | — | — |
| #2412 | v1.75.0 | fix(zernio): desconectar apaga a assinatura sem id pela URL do canal | NÃO SE APLICA | redes sociais/Zernio — canal que não usamos | — | — |
| #2414 | v1.75.0 | fix(inbox): a lista não volta ao skeleton num refetch (#2366) | PORTAR (limpo) |  | abb76ee31 | — |
| #2416 | v1.75.0 | fix(lgpd): a máscara de Portugal cobre as formas reais, e o scrub não desfigura número internacional (#2345) | NÃO SE APLICA | perfil jurídico de Portugal/RGPD — operação é Brasil | — | — |
| #2417 | v1.75.0 | feat(social): desvincular perfil, órfã visível e erro que orienta | NÃO SE APLICA | redes sociais/Zernio — canal que não usamos | — | — |
| #2420 | v1.75.0 | fix(lgpd): os feriados brasileiros do prazo são calculados, sem fim em 2030 (#2413) | ADAPTAR | holidays-pt.ts segue fora (Portugal/RGPD não portado) | 3b529e482 | — |
| #2110 | v1.75.0 | docs(cobranca): plano de implementação do PR 2 — planos e limites | NÃO SE APLICA | cobrança do revendedor (Stripe/Asaas/planos) — não usamos | — | — |
| #2423 | v1.75.0 | fix(api-tokens): o token vale o MAIOR papel marcado, não o primeiro | PORTAR (limpo) |  | 074bf72d0 | — |
| #2425 | v1.75.0 | feat(admin): a tela de Sistema mostra se o WhatsApp já assina as entregas | ADAPTAR | só o bloco da assinatura entra na tela de Sistema do fork (o redesenho de recursos opcionais e o mapa recursos-opcionais.architecture.json não foram portados); serve de verificação do passo manual do #2268 (mostra 'não' enquanto prod usa o nome antigo) | 4a4aa6e7f | — |
| #2424 | v1.75.0 | fix(social): excluir canal social apaga a assinatura de webhook no Zernio | NÃO SE APLICA | redes sociais/Zernio — canal que não usamos | — | — |
| #2121 | v1.75.0 | fix(agente): conferência semântica de promessa sai da transação do envio (travamento em ciclo com DDL, #2363) | PORTAR (limpo) |  | 758223a0d | — |
| #2430 | v1.75.0 | fix(lgpd): o 20 de novembro conta como feriado no prazo do Brasil a partir de 2024 (#2421) | PORTAR (limpo) |  | 7cf00816c | — |
| #2435 | v1.76.0 | fix(sentry): o scrub do Jev passa a conhecer o perfil do país (#2418) | NÃO SE APLICA | Jev (serviço externo) — não habilitado no fork | — | — |
| #2433 | v1.76.0 | fix(canais): canal pausado não reage — push, follow-up, retorno, automação e follow-up agendado | ADAPTAR | sem handleGroupInbound e sem os testes de grupo (cadeia de grupos não portada); push 1:1 ganha a guarda do canal desativado; push.handler.test.ts do fork mantido | c904a6ce7 | — |
| #2309 | v1.76.0 | fix(midia): o anexo da nota interna entra na retenção por idade (#1887) | ADIAR | 0572 redefine fn_enfileirar_midia_vencida como UNIÃO com a 0557 (#2180, adiado: interruptor de retenção + media_status expired) — portar junto com o #2180 | - | 0572 |
| #2431 | v1.76.0 | fix(router): destino de funil/etapa do roteador persiste após salvar e recarregar (#2415) | ADAPTAR | sem flow_pointer_id (roteiros #1573 adiados) no camposDoMembro e no SELECT da página; _client.test.tsx segue apagado no fork; page.test.tsx novo entra (prova o SSR com destino) — importante: sem isto, salvar o roteador de novo apagava o destino do #2290 | db5f7a9da | — |
| #2445 | v1.76.0 | fix(mcp): crm_manage_tags emite tag_added como a tela (de @rgisjr, #2444) | PORTAR (limpo) |  | 872d93ad8 | — |
| #2438 | v1.76.0 | Conferir as afirmações de fato da resposta antes do envio (terceira camada do before_send) | NÃO SE APLICA | conferência de afirmações de fato no before_send roda sobre o Jev (lib/ai/decisao, não portado) | - | — |
| #2411 | v1.76.0 | feat(celular): barra de abas, movimento nos sobrepostos e alvos de 44px | ADAPTAR | e2e.yml: partes do fork mantidas, specs novas na SPECS_PARTE_5; sem capacidades_ligadas no sidebarGroups (cadeia de capacidades não portada) | 5409c8031 | — |
| #2441 | v1.76.0 | feat(videochamada): botão de vídeo por Jitsi Meet no cabeçalho da conversa | ADIAR | videochamada Jitsi — depende de recursos opcionais (#1876) | — | — |
| #2454 | v1.76.0 | build(deps): bump @modelcontextprotocol/sdk from 1.30.1 to 1.31.0 | ADIAR | bump do SDK MCP — junto com o bump geral de dependências | — | — |
| #2437 | v1.76.0 | feat(jev): sinal de urgência da mensagem represada — o modelo só opina e só abre alerta (#2232) | NÃO SE APLICA | Jev (serviço externo) — não habilitado no fork | — | — |
| #2455 | v1.76.0 | fix(conversoes): regras de etapa da Meta funcionam pelo canal intermediado — aparecem na tela e o evento sai | NÃO SE APLICA | canal oficial/intermediado/Graph — não usamos (só WAHA) | — | — |
| #2458 | v1.76.0 | fix(ia): assinatura do ChatGPT segue o módulo login_codex em Provedores, no agente e no onboarding | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | — |
| #2452 | v1.76.0 | feat(webhooks): autorize IA por fonte de formulário | ADAPTAR | 0577 (migration e apêndice) sem 'and not c.is_personal' — coluna da conversa pessoal #2391 não existe no fork e a função SQL quebraria a instalação; invariante sem os casos de is_personal (a provar em test:db); bloco 0564 (pessoal) fora do baseline; testes #16 | d6a3cd8a9 | 0577 |
| #2459 | v1.76.0 | feat(automacoes): interruptor por empresa desliga o passo ai_decide (#2367) | ADIAR | interruptor do passo ai_decide — depende do #2228 (adiado) | - | — |
| #2460 | v1.76.0 | feat(agenda): copiar horarios da jornada para os outros dias e resumo do publicado (#2312) | PORTAR (limpo) |  | f7dfb501a | — |
| #2461 | v1.76.0 | Autocomplete de menção de atendentes (@) em notas internas | ADAPTAR | só a menção: sem NoteMedia/anexo de nota (#1863 não portado), sem o aviso de rascunho sugerido (#1611 adiado) no Composer, export LGPD do fork intacto (o fork não exporta conversation_notes/drafts — lacuna registrada nos achados) | 5f39a90fb | — |
| #2464 | v1.76.0 | fix(hooks): invariante criado pela própria branch pode ser ajustado sem válvula | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2466 | v1.76.0 | fix(configuracoes): a confirmacao da limpeza de midia cita o anexo da nota interna | ADIAR | texto da confirmação do interruptor de limpeza de mídia — depende do #2180/#2309 (adiados) | - | — |
| #2469 | v1.76.0 | perf(webhook-waha, scheduler): menos chamadas ao Supabase por evento do WhatsApp e no recover-stuck-messages | ADAPTAR | scheduler: recover-stuck-messages a cada 5 min como no upstream; cron proposta-travada fora (propostas não portadas) | 0602cdb2e | — |
| #2468 | v1.76.0 | fix(waha): eco que chega no meio do envio não pausa a IA nem duplica a mensagem | ADAPTAR | tests/helpers/duble-do-handler.ts trocado pela versão do upstream (a do fork era só mais antiga, sem personalização; os 7 arquivos que a usam passam); messages-handler-eco-duplicado.test.ts do fork: casos novos usam makeSupabase e o fake ganhou like() | a3e3efeff | — |
| #2470 | v1.76.0 | fix(agenda): idle convergente limpa erro morto de sincronizacao Google | PORTAR (limpo) |  | 72e33a00b | 0578 |
| #2472 | v1.76.0 | test(e2e): a limpeza do suporte-temporario para de esperar desfecho de pedido órfão | PORTAR (limpo) |  | 6f1dc60bc | — |
| #2462 | v1.76.0 | fix(ia): a credencial da assinatura do ChatGPT só nasce pelo login | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | — |
| #2142 | v1.76.0 | fix(kit): o restore.sh falha alto em banco existente em vez de dizer que restaurou | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2204 | v1.77.0 | feat(mcp): servidor MCP externo registrável e invocável (Refs #2147) | ADIAR | servidor MCP externo registrável (27 arquivos, 0580) — superfície de segurança nova (IA chama servidor de terceiro); porte dedicado | — | 0580 |
| #2220 | v1.77.0 | feat(crm): conta a receber ao fechar pedido como ganho no Kanban (Refs #1477) | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | — |
| #2476 | v1.77.0 | o evento de negócio ganho só nasce do próprio negócio | PORTAR (limpo) |  | 59612d72e | 0581 |
| #2477 | v1.77.0 | fix(deps): sobe três transitivas com alerta de segurança | ADAPTAR | pnpm-lock.yaml regenerado a partir do lock do fork com pnpm install --lockfile-only (sharp 0.35.5, seroval 1.6.9, source-map-js 1.2.2) | 150cbc73c | — |
| #2213 | v1.77.0 | Planos de tarefa: sequência reutilizável aplicada ao negócio (fatia sem migration) (#1752) | ADIAR | planos de tarefa: depende da ação create_task / lib/tarefas/criar-tarefa (#1540, não portada) — portar com essa cadeia | - | — |
| #2478 | v1.77.0 | fix(suporte): aba que carregava durante a troca de acompanhamento se reconcilia ao montar | PORTAR (limpo) |  | e8867e2ab | — |
| #2479 | v1.77.0 | fix(financeiro): comanda do ganho com moeda certa, audit da abertura e corrida fechada | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | 0582 |
| #2481 | v1.77.0 | fix(suporte): a aba que grava o aviso de troca não se recarrega sozinha | PORTAR (limpo) |  | 052c7301b | — |
| #2485 | v1.77.0 | fix(waha): a citação do cliente vira fio na ingestão (refs #2474) | ADAPTAR | envelope só com replyTo (participant/author são da cadeia de grupos, não portada) | 2a29d7ecd | — |
| #2487 | v1.77.0 | fix(automacao): salvar pela tela preserva o filtro de funil e etapa (refs #2483) | ADAPTAR | só o ramo do gatilho de data no RuleEditor (gatilhos de tempo não existem no fork); config-ao-salvar.test.ts usa os nomes do upstream como rótulos; rule-editor-preserva-config-ao-salvar.test.tsx reapontado para o gatilho de data (stage_id é a chave que a tela  | fdc1e88d9 | — |
| #2118 | v1.77.0 | perf(ia): classificações de etapa e de manipulação usam o modelo econômico do mesmo provedor | ADIAR | modelo econômico nos classificadores (custo): construído sobre #2385 (par provedor-modelo), reserva de chave e Jev — portar com a cadeia de seleção de modelo | - | — |
| #2131 | v1.77.0 | perf(waha): memoiza o check-exists positivo por sessão e número | PORTAR (limpo) |  | 0ef9b6e03 | — |
| #2338 | v1.77.0 | perf(envio): uma conferência por corte no envio do agente, não duas | ADAPTAR | a economia vale só para assertAgentOperationSupabase; assertEscopoDaEtapaSupabase (política por etapa 0404) continua a cada envio — caso novo em envio-por-bolha-confere-uma-vez.test.ts (contato vai para etapa só-humana entre as bolhas → 2ª calada), sabotado; d | f037a530c | — |
| #2434 | v1.77.0 | perf(ia): leituras independentes do turno correm em paralelo antes do modelo | ADIAR | perf (leituras do turno em paralelo): reestrutura get-lead-context sobre a consulta de histórico do episódio, onde o fork tem correção própria (outbound por created_at, medida em produção 26/09) e inclui propostas (não portadas) — risco de perder a correção se | - | — |
| #2119 | v1.77.0 | perf(ia): classificadores só rodam quando há mensagem nova, e o de estágio lê menos | ADIAR | perf dos classificadores do turno: o trecho do upstream é entrelaçado com a terceira perna do Jev (manipulação); o fork já pula o classificador de estágio sem update_lead_state (0404) | - | — |
| #2127 | v1.77.0 | perf(envio): leituras do caminho de envio param de varrer o histórico | PORTAR (limpo) |  | 8c6ba62c2 | — |
| #2141 | v1.77.0 | fix(ia): o motor passa a cobrar os modelos Gemini do catálogo | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | — |
| #2489 | v1.77.0 | fix(inbox): menção apagada sai da lista e não notifica a pessoa errada (refs #2463) | ADAPTAR | import sem o rascunho sugerido (#1611 adiado) | c45006228 | — |
| #2491 | v1.77.0 | feat(#2382): channel selector before creating a new conversation | ADAPTAR |  dicionário: só as chaves deste PR; mapa en.json: só a mudança deste PR aplicada sobre o do fork; | 774740681 | — |
| #2492 | v1.77.0 | fix(scheduler): o segredo dos crons não entra mais na linha de comando | PORTAR (limpo) |  | c05dfb93c | — |
| #2495 | v1.77.0 | fix(ia): "Conversar sobre o caso" enxerga a credencial da organização, não só o .env | PORTAR (limpo) |  | 78cbfa03d | — |
| #2499 | v1.77.0 | feat(inbox): show the channel label in the conversation list and header (#2383) | ADAPTAR | allowlist do rotulo-do-contato: as duas entradas em conflito (ConversationListItem antigo e RedesSociais) não existem mais no código do fork — removidas; teste verde | 85e3ca017 | — |
| #2500 | v1.77.0 | fix(mcp): crm_move_lead_stage aceita lost_reason | PORTAR (limpo) |  | 575ed5231 | — |
| #2496 | v1.77.0 | feat(central): notice for a paused connection that resolves itself | ADAPTAR | 0589 reescrita: CHECK de agent_inbox_items.kind = lista do FORK + canal_pausado (o upstream somava tipos de Jev/propostas/org reativada, não portados); baseline só com o bloco 0589 (0582 comanda e mcp_externo de carona fora); social/store.ts e disconnect.test. | 6b1204e7b | 0589 |
| #2502 | v1.77.0 | fix(tenant): organization labels come from the country profile (#1946 item 4) | NÃO SE APLICA | rótulos da organização pelo perfil do país (PERFIL_PT/NIPC) — cadeia Portugal/RGPD não portada | - | — |
| #2501 | v1.77.0 | fix(agent-engine): a IA não fica parada depois de uma queda do banco | PORTAR (limpo) |  | e308e14e1 | — |
| #2507 | v1.77.0 | fix(ia): o degrau econômico só troca para modelo que o motor sabe cobrar | ADIAR | ajuste do degrau econômico — depende do #2118 (adiado, cadeia de seleção de modelo) | - | — |
| #2337 | v1.77.0 | perf(ia): o webhook pede o turno do agente antes de drenar o event_log | ADIAR | perf (webhook pede o turno antes de drenar): reescreve dispatcher/drain do event_log com orgParada (suspensão #1987, não portada) e dreno escopado — núcleo crítico, ganho só de latência | - | — |
| #2513 | v1.77.0 | test(campanhas): regressão do corte em 1.000 linhas e do aviso do teto (#2402) | PORTAR (limpo) |  | 2ca0ebe38 | — |
| #2504 | v1.77.0 | Relatorio por canal: volume, 1a resposta humana e vazamento por numero (#2390) | PORTAR (limpo) |  | da2707039 | 0590 |
| #2510 | v1.77.0 | fix(legal): página inicial pública e política de privacidade com os dados do Google | NÃO SE APLICA | página inicial pública/política com dados do Google do upstream — nossa instalação tem domínio e marca próprios | — | — |
| #2128 | v1.77.0 | perf(banco): índices do caminho quente do agente e da poda da fila | ADAPTAR |  baseline: apêndice antes do bloco final do fork, objetos conferidos (checkobj sem divergência); | caea8ec33 | 0585 |
| #2130 | v1.77.0 | perf(ia): a IA para de gastar com trabalho de fundo que não muda nada | ADIAR | perf (IA para de gastar com trabalho de fundo): ai-sentiment-worker reescrito sobre o Jev (tarefas clima/pedidos) e ai-response-worker reordenado sobre guardas do fork (corte de conexão, agente pausado) — só custo, risco alto | - | — |
| #2518 | v1.77.0 | test(e2e): a moldura da prévia escura é esperada, não lida uma vez só | PORTAR (limpo) |  | 9db25ce61 | — |
| #2129 | v1.77.0 | feat(ia): mede o custo da mídia e o tempo de cada atendimento | ADIAR | custo da mídia + teto de gasto na visão: construído sobre validarParProvedorModelo (#2385, adiado) — DEFEITO REAL do fork: a leitura de imagem chama o provedor fora do runModelCall e ignora o teto de gasto; portar com #2385 | - | — |
| #2519 | v1.77.0 | test(ia): o DELETE da credencial nunca promete o que a FK recusa (#1142) | PORTAR (limpo) |  | a671f28bb | — |
| #2512 | v1.77.0 | Mensagem da IA sai no formato do WhatsApp ( | PORTAR (limpo) |  | cd7a96a9a | — |
| #2140 | v1.77.0 | feat(retencao): as tabelas append-only da IA ganham prazo configurável | ADIAR | prazo configurável das tabelas append-only da IA: rota data-retention do upstream divergiu (podas Jev/rascunhos/golden não portadas) — porte dedicado da cadeia de retenção com #2180/#2309/#2466 | - | 0587 |
| #2525 | v1.77.0 | fix(waha): o envio carimba a forma canônica do external_id e o unique fecha a corrida (#196) | PORTAR (limpo) |  | 1d1268e2f | — |
| #2531 | v1.77.0 | fix(release): exige_acao sai como minor; major só com pedido explícito do dono | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2523 | v1.77.0 | fix(agenda): entregue a hora local e as ações concluídas ao resumo | ADAPTAR | mcp-lista-agendamentos-periodo.test.ts fora (testa filtro de período da lista de agendamentos, PR anterior não portado) | 33750a1f3 | — |
| #2530 | v1.77.0 | fix(gov): o status T (troca de tipo) passa pela válvula do freeze como M (#2465) | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2139 | v1.77.0 | feat(ia): a tela "Uso de IA" soma o período inteiro no banco e nomeia o que mede | ADAPTAR |  mapa teto-de-orcamento.architecture.json: só a mudança deste PR aplicada sobre o do fork; baseline: apêndice antes do bloco final do fork, objetos conferidos (checkobj sem divergência); | ec8ba3f2f | 0586 |
| #2532 | v1.77.0 | fix(funil): a exclusão de um funil já arquivado não manda arquivar de novo (#979) | PORTAR (limpo) |  | 8371822e7 | — |
| #2556 | v1.77.0 | leads: recusa da RLS (42501) vira 403, não 500 | PORTAR (limpo) |  | d712ed8fa | — |
| #2536 | v1.77.0 | build(deps): bump next from 16.3.6 to 16.3.8 | ADAPTAR | só o next (16.3.5 → 16.3.8, travado como no upstream); lucide-react de carona fora; lock regenerado do lock do fork | 62c9e80e1 | — |
| #2534 | v1.77.0 | fix(legal): o nome da marca nas páginas /legal vem do banco (#2511) | ADAPTAR | operador.ts com marcaDaSaida + resolveActiveOrg (sem orgAtivaSemPortao); página de login do fork passa a ler a marca do banco (era branding()/.env, mesmo defeito do #2511); cerca: app/page.tsx do fork só redireciona — o login entra no lugar | 7ff9293f6 | — |
| #2557 | v1.77.0 | fix(tarefas): reabrir uma tarefa cancelada volta para pendente (#2549) | PORTAR (limpo) |  | df6059ba3 | — |
| #2558 | v1.77.0 | fix(kanban): com filtro ligado, soltar um card não empata mais a posição com um card escondido | ADAPTAR | imports do fork (Button, Caret) mantidos + chaveDoQuadro | f6eac9f06 | — |
| #2554 | v1.77.0 | perf(metricas): recorte da janela ANTES do lateral em fn_attendant_metrics e fn_channel_metrics (#2514) | PORTAR (limpo) |  | 2e4269dff | 0596 |
| #2453 | v1.77.0 | fix(ai): ofereça Gemini 3.5 Flash-Lite no provedor Google | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | 0599 |
| #2571 | v1.77.0 | test(invariants): a medição de custo das métricas não usa o teto de 8 s | PORTAR (limpo) |  | e96359c93 | — |
| #2560 | v1.78.0 | fix(metrics): perdas e funil paginam contra o max_rows de 1000 e o truncado liga (#2548) | PORTAR (limpo) |  | 0c410c43f | — |
| #2544 | v1.78.0 | feat(rgpd): tela das alíneas a), c) e d) do art. 15.º para o controlador (#2356) | NÃO SE APLICA | perfil jurídico de Portugal/RGPD — operação é Brasil | — | — |
| #2493 | v1.78.0 | fix(agenda): recusa na tela a chave do Google colada junto com o JSON | PORTAR (limpo) |  | 9dcd74068 | — |
| #2552 | v1.78.0 | fix(followup): mover lead para etapa de perda exige o motivo da perda | ADIAR | motivo da perda no nó move_lead do follow-up — o nó vem do #2181 (#2065, adiado) e da tarefa interna #1540; portar junto, com a trava de saída (exit_locked) no moverLeadNoFunil | - | — |
| #2539 | v1.78.0 | feat(inbox): prévia da mensagem em tempo real na janela fechada (#2446) | NÃO SE APLICA | prévia da janela fechada — canal oficial (Meta) | — | — |
| #2537 | v1.78.0 | fix(banco-externo): o módulo desligado esconde as ferramentas e a tabela com maiúscula é achada | PORTAR (limpo) |  | 2750607e6 | — |
| #2543 | v1.78.0 | fix(crm): lead nasce no funil padrão quando a conversa começa pelo celular (#2448) | ADIAR | DECISÃO DO DONO: lead nasce no funil padrão quando a conversa começa pelo celular — na escola, a secretaria falando com pai/aluno sem negócio abriria card COMERCIAL (política comercial → agente comercial pode atender); depende também de lib/channels/origem-do- | - | — |
| #2570 | v1.78.0 | feat(webhooks): personalizar formulários e direcionar automações por fonte (substitui #2553) | ADAPTAR | sem gatilhos de tempo (#1540) no RuleEditor/schemas, sem o veto de laço #1528 na rota/schemas e sem a guarda de contato pessoal (#2391) no motor; outros gatilhos seguem mandando trigger_config undefined (não {}), para não apagar config gravada; baseline só com | b67d8fb3c | 0595 |
| #2572 | v1.78.0 | fix(kit): a URL do Supabase só passa quando quem responde é o GoTrue | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2538 | v1.78.0 | fix(teste): dry-run prepara a mídia do produto como o envio real (#2490) | PORTAR (limpo) |  | 91f784653 | — |
| #2551 | v1.78.0 | fix(#2522): CPF do contato volta a ser persistido — encrypt_cpf/decrypt_cpf nascem no schema (0591) | ADAPTAR | kit: bloco da chave do CPF sem t() (o kit do fork não tem i18n; _i18n.sh segue fora); varredura de definer só com encrypt_cpf/decrypt_cpf (a entrada de honorários é de cadeia não portada). Produção do fork (deploy-vps.sh não semeia): PASSO MANUAL para o CPF pa | 220b55ee8 | 0597 |
| #2573 | v1.78.0 | fix(kit): rede do Traefik com mais de uma rede prefere a coolify ou recusa | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2565 | v1.78.0 | fix(kit): backup.sh grava banco, sessão do WhatsApp e anexos só para o dono | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2114 | v1.78.0 | feat(cobranca): planos e limites da cobrança do revendedor (PR 2 de 3) | NÃO SE APLICA | cobrança do revendedor (Stripe/Asaas/planos) — não usamos | — | 0583 |
| #2427 | v1.78.0 | feat(lgpd): o titular brasileiro recebe o arquivo de dados, sem o que é da equipe (doc 103, A) | ADIAR | titular recebe o data.json (doc 103): construído sobre a cadeia LGPD por país (doc88, PT) e o export de notas/rascunhos (#1863) — porte dedicado de LGPD, junto da lacuna do export de conversation_notes | - | — |
| #2456 | v1.78.0 | feat(ai): conecte a assinatura do ChatGPT sem chave de API | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | 0592 |
| #2566 | v1.78.0 | fix(kit): install.sh apaga o temporário da pendência de e-mail ao sair | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2577 | v1.78.0 | fix(oauth): o retorno do login de anúncios vale uma vez só | PORTAR (limpo) |  | 2b88cf2ca | — |
| #2567 | v1.78.0 | fix(kit): healthcheck mostra a razão da falha do agente em vez de uma linha vazia | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2568 | v1.78.0 | docs(kit): o guia da HostGator entra pela porta 22022 do SSH | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2578 | v1.78.0 | fix(oauth): a conexão de anúncios confere quem começou | ADIAR | OAuth de anúncios confere quem começou — conversões Google não portadas | — | — |
| #2581 | v1.78.0 | ci(verify): a quarta parte leva o kit e as cercas | NÃO SE APLICA | governança/triagem/hooks do repositório upstream | — | — |
| #2574 | v1.78.0 | fix(kit): instalação com o Supabase na VPS deixa de pedir token sbp_ da nuvem | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2533 | v1.78.0 | feat(ia): adiciona Gemini 3.x ao catalogo de modelos | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | 0600 |
| #2583 | v1.78.0 | fix: o aviso de mensagem vai para o responsável, o follow-up não para pela agenda e o clima respeita o teto de | ADAPTAR | clima: worker do fork mantido (o do upstream é sobre o Jev), com a checagem do teto (podeGastarComIa) inserida antes da chamada paga — DEFEITO REAL do fork (clima cobrava com 'parar a IA'); teste do upstream com as guardas do fork (corte 0403, elegibilidade) m | 8221cacb3 | — |
| #2586 | v1.78.0 | fix(inbox): o fim do envio remove só as menções daquela nota (refs #2463) | PORTAR (limpo) |  | 9d51873c7 | — |
| #2585 | v1.78.0 | fix(api): duplicados e auditoria leem além das 1.000 caladas (closes #2561) | PORTAR (limpo) |  | db2b57e31 | — |
| #2116 | v1.78.0 | fix(extensoes): instalar do catálogo oficial volta a funcionar | NÃO SE APLICA | catálogo de extensões — extensões não usadas | — | 0511 |
| #2588 | v1.78.0 | fix(leads): no 'Só os seus', o negócio que o Atendente cria nasce dele (#2547) | PORTAR (limpo) |  | 00ab8ebb8 | — |
| #2590 | v1.78.0 | fix(notificacoes): o aviso de mensagem nova respeita quem pode ver a conversa | ADAPTAR | push.handler.ts do fork (sem handleGroupInbound); baseline só com o bloco 0612 (0583 cobrança e 0592 assinatura de carona fora); fn_can_view_conversation do fork conferida (mesma assinatura/régua); push.handler.test.ts do upstream sem os casos de grupo e sem o | e0244b5f8 | 0612 |
| #2592 | v1.78.0 | fix(notificacoes): o aviso de menção segue quem pode ver a conversa | PORTAR (limpo) |  | eb125a2df | — |
| #2334 | v1.78.0 | feat(modulos): onda 1 da ADR-0005 (#2334) | NÃO SE APLICA | módulos ADR-0005 onda 1 — módulos não usados | — | 0611 |
| #2598 | v1.78.0 | cerca-tenant: R3 cobra organization_id em cadeia por chave e cobre os 9 filtros (#2546) | ADAPTAR | rota de propostas fora; a R3 nova pegou lib/relogio/executar.ts (varredura de followup_enrollments por status, sem id de fora — legítima; no upstream passa pelo filtro de suspensão 0501) → declarada em CHAVE_SEM_TENANT_LIBERADA com a razão | 241931b73 | — |
| #2607 | v1.78.0 | fix(agente): o turno de resposta que terminou sem mensagem ao cliente pede UMA correcao (#2607, de @jmpo) | ADAPTAR | sem o descarte de turno obsoleto (#1943, não portado): turnoDescartado: false; a correção do turno mudo passa pela cadeia inteira do fork (trava de envio e escopo da etapa) | ade4108ef | — |
| #2368 | v1.78.0 | feat(cobranca): Stripe, webhook, reconciliação e régua (PR 3a, rascunho) | NÃO SE APLICA | cobrança do revendedor (Stripe/Asaas/planos) — não usamos | — | 0601 |
| #2610 | v1.78.0 | fix(afirmacao-de-fato): paráfrase com preço na evidência não vira vetado_sem_base (#2582) | NÃO SE APLICA | ajuste da conferência de afirmação de fato (#2438, Jev — não se aplica) | - | — |
| #2599 | v1.78.0 | fix(preview): previa usa janela de resposta na junta de pacing (#2555) | PORTAR (limpo) |  | 4b49293a1 | — |
| #2596 | v1.78.0 | fix(ai): RunTrace le os dois formatos de tool_call na aba Teste (#2550) | PORTAR (limpo) |  | 8fbbfbd8b | — |
| #2597 | v1.78.0 | fix(clipboard): fallback do textarea nasce dentro do diálogo com focus trap (#2580) | PORTAR (limpo) |  | 8f96392ae | — |
| #2600 | v1.78.0 | fix(roteador): editor busca o detalhe ao abrir (refs #2569) | PORTAR (limpo) |  | 67f30cd0d | — |
| #2603 | v1.78.0 | fix(retencao): teto de 36500 dias em interpretarRetencao | ADAPTAR | import do teste só com RETENCAO_TETO_DIAS (rascunhos 0419 não portados) | ff57bafa8 | — |
| #2615 | v1.78.0 | fix(cobranca): o aviso do provedor só toca o ponteiro de plataforma | NÃO SE APLICA | cobrança do revendedor (Stripe/Asaas/planos) — não usamos | — | — |
| #2616 | v1.78.0 | fix(kit): rejeitar catálogo de extensões vazio (separado do #2608) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2614 | v1.78.0 | feat(mcp): o registro de auditoria da ferramenta guarda o tamanho da resposta (Fatia 5 da Spec 23) | PORTAR (limpo) |  | d0dddd364 | — |
| #2606 | v1.78.0 | fix(followup): o passo do fluxo não fala por cima de quem assumiu a conversa | PORTAR (limpo) |  | 1a86d941b | — |
| #2605 | v1.78.0 | fix(funil): desarquivar confere o nome e arquivar o funil de clientes é recusado (#2559) | PORTAR (limpo) |  | e4dd422ac | — |
| #2604 | v1.78.0 | feat(inbox): divisórias arrastáveis entre lista, conversa e ficha (#2579) | PORTAR (limpo) |  | c4c32e5c1 | — |
| #2617 | v1.78.0 | fix(metricas): as métricas do run voltam a gravar — o organization_id do UNION precisa de tipo | ADAPTAR | o fork não tem o UNION do #2129 (adiado), logo não tinha o defeito; só o $1::uuid entra; invariante metricas-do-run-gravam fora (mede métricas do #2129) | e75aecc96 | — |
| #2618 | v1.78.0 | fix(canal): a rota global do webhook do WhatsApp só atende a rede interna | PORTAR (limpo) |  | d3d29326d | — |
| #2625 | v1.79.0 | feat(tenants): gestão de tenants pelo admin (substitui #1967, de @Draven9) | ADIAR | gestão de tenants pelo admin (51 arquivos) — instalação de uma empresa só | — | 0614 |
| #2621 | v1.79.0 | fix(engine): cliente que falha dentro da transação não volta ao pool sem erro (#2506) | PORTAR (limpo) |  | ca1215200 | — |
| #2620 | v1.79.0 | fix(agenda): lembrete fora da janela de 24h do Instagram nao carimba como enviado e tenta outro canal | NÃO SE APLICA | redes sociais/Zernio — canal que não usamos | — | — |
| #2622 | v1.79.0 | fix(ia): listagem de modelos da assinatura fala com o backend do Codex (#2602) | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | — |
| #2623 | v1.79.0 | fix(retencao): teto de 36500 dias nos dois prazos do arquivo de webhooks | PORTAR (limpo) |  | ebf97ae6a | — |
| #2517 | v1.79.0 | fix(kit): o app fica sem build: de propósito — testes prendem a régua e o kit diz o que o Compose mede (#1060) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2619 | v1.79.0 | feat(inbox-media): exibe o nome original do documento no cartão do inbox (#2613) | ADAPTAR | DocumentCard ganha fileName (sem src de anexo de nota #1863); lib/channels/meta/* do fork (eco da coexistência não portado) + import de nomeDeArquivoLimpo no ingest da Meta; teste sem o caso do eco da Meta | 9c3a41a10 | — |
| #2632 | v1.79.0 | chore(i18n): global-error en español y tuteo neutro en el diccionario | ADIAR | revisão do espanhol do dicionário (tuteo) — conflito largo no dicionario.ts, sem ganho para a operação pt-BR | - | — |
| #2633 | v1.79.0 | test(mcp): result_bytes também no vazio declarado, e declara o campo medido (follow-up do #2614) | PORTAR (limpo) |  | f6f2edb92 | — |
| #2156 | v1.79.0 | feat(ia): passagem por assunto jurídico vira chave por agente (#2097) | ADIAR | passagem por assunto jurídico por agente: recria fn_ai_agent_version_content_immutable a partir do upstream (apagaria da trava as colunas do fork, caso #2013) e conflita em 13 arquivos da versão do agente; para escola o padrão (ligado) é o certo — portar só se | - | 0616 |
| #2645 | v1.79.0 | fix(cron): uma poda que falha não derruba as irmãs nem pula o dia da LGPD (closes #2508) | ADAPTAR | reescrito na rota do fork (diff do upstream não aplica): executarDreno + falhas nomeadas + anonimização sempre roda; teste novo sabotado | 98701c937 | — |
| #2646 | v1.79.0 | fix(marca): a dica do relatório fala a língua do país da organização (closes #2503) | PORTAR (limpo) |  | d290af441 | — |
| #2629 | v1.79.0 | fix(ia): revise ofertas com evidências e contexto comercial | ADAPTAR | turno: só o classificador com recuperação de evidências (a conferência de afirmações #2231 é do Jev, fora); run-model-call do fork (reserva de modelo não portada); baseline só com a 0617 (0599/0600/0583 de carona fora); mapa agent-turn via jsonmerge sem os nós | e9ff138d2 | 0617 |
| #2651 | v1.79.0 | fix(lgpd): o data.json sai em stream e o arquivo parcial sai com ressalva (#2576) | ADIAR | data.json em stream / arquivo parcial com ressalva — depende da cópia do titular (#2427, adiado); porte dedicado de LGPD | - | — |
| #2650 | v1.79.0 | fix(cobranca): o painel relê o provedor antes da trava de assinatura viva | NÃO SE APLICA | cobrança do revendedor (Stripe/Asaas/planos) — não usamos | — | — |
| #2652 | v1.79.0 | fix(pool): cliente que falha numa transação não volta ao pool sem erro (#2624) | ADAPTAR | lib/prospecting/agent-chat.ts do fork (prospecção não se aplica) e o caso dele fora do teste do pool; a correção do pool vale no resto | 8496a1e97 | — |
| #2653 | v1.79.0 | fix(cron): a poda interrompida no meio leva o parcial dos lotes que passaram (refs #2508) | ADAPTAR | reescrito na rota do fork: FalhaComParcial leva o parcial dos lotes; teste sabotado | 369b41f7b | — |
| #2654 | v1.79.0 | test(lgpd): data.json do titular preso à saída anterior ao #2651 | ADAPTAR | teste dourado do data.json removido no commit do #2673 (depende do #2651, adiado) | 22a7b46be | — |
| #1907 | v1.79.0 | feat(financeiro): a comanda nasce na instalação do módulo pela provisionadora (ADR-0002) | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | 0619,0620 |
| #2660 | v1.79.0 | fix(conversoes): etapa com evento fora do vocabulário do canal vira pendência com motivo visível | ADIAR | conversões — cadeia não portada | — | — |
| #2661 | v1.79.0 | Financeiro: itens do catálogo ganham botão Editar — PATCH que já existia, sem desativar e recriar | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | — |
| #2662 | v1.79.0 | test(followup): o nome da sessão do teste de reatividade tem tamanho fixo (o invariants falhava por sorteio) | PORTAR (limpo) |  | 2468791fd | — |
| #2664 | v1.79.0 | fix(inbox): o fio ancora no fim quando o cartão de passagem chega antes das mensagens | PORTAR (limpo) |  | 1e125382b | — |
| #2663 | v1.79.0 | fix(onboarding): pular o passo do funil liga as etapas que o gatilho semeou | PORTAR (limpo) |  | cc0653969 | 0621 |
| #2667 | v1.79.0 | Carteira do cliente: o contato ganha um vendedor dono, o dono é avisado quando o cliente fala com outro, e o n | ADIAR | carteira do cliente (vendedor dono) — decisão de produto: interage com escopo comercial/acadêmico e roteamento | — | 0622 |
| #2670 | v1.79.0 | orders: aceitar pedidos de plataforma sem integração nativa (ex.: Tray) por origem genérica | NÃO SE APLICA | financeiro/comandas/pedidos — outro nicho | — | 0623 |
| #2673 | v1.79.0 | feat(conexoes): pausa agendada de conexoes com retomada automatica (#2388) | ADAPTAR | baseline só com a 0626 (0622 carteira de carona fora); rls-isolation só com a semente da channel_schedules (B2B 0448 e rascunho 0419 não portados); traduções só as do PR, inseridas à mão; cron sem idsDeOrgsParadas (suspensão não portada: conjunto vazio; caso ' | 713c55570 | 0626 |
| #2397 | v1.79.0 | feat(cobranca): Asaas, Pix e boleto recorrentes (PR 3b, rascunho) | NÃO SE APLICA | cobrança do revendedor (Stripe/Asaas/planos) — não usamos | — | — |
| #2675 | v1.79.0 | fix(ai): o agente pela assinatura fecha o turno — o ramo do streamText devolve a fita (responseMessages) | NÃO SE APLICA | agente pela assinatura (streamText do provedor ChatGPT) — provedor não portado | - | — |
| #2524 | v1.79.0 | feat(kit): banco na VPS atrás do proxy do Coolify, e o guia medido (PR 4) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2678 | v1.79.0 | fix(meta): envia parameter_name em templates NAMED no Inbox e na API | NÃO SE APLICA | canal oficial/intermediado/Graph — não usamos (só WAHA) | — | — |
| #2677 | v1.79.0 | fix(followup): texto fixo respeita a janela de disparo do canal e a faixa do agente | ADAPTAR | settle do fork sem OrgNaoOperante (suspensão não portada), com o adiamento na assinatura nova; mock do teste do fork mantém fn_followup_pode_enviar (corte 0403) e ganha settleCalls. Corrige defeito real: texto fixo do follow-up saía fora da janela de disparo | b46b8b28a | — |
| #2589 | v1.79.0 | fix(modulos): Recursos opcionais passa a dizer ONDE o recurso aparece | NÃO SE APLICA | recursos opcionais/módulos — área não portada | — | — |
| #2683 | v1.79.0 | fix(lgpd): o rótulo da seção de módulo preserva o nulo da coluna (refs #2656) | NÃO SE APLICA | rótulo de seção LGPD de módulo — módulos não usados | — | 0628 |
| #2682 | v1.79.0 | fix(branding): cor da marca opcional no tema escuro, como o par de logo (refs #2482) | ADAPTAR |  baseline: apêndice antes do bloco final do fork, objetos conferidos (checkobj sem divergência); | 8aefc994e | 0627 |
| #2687 | v1.79.0 | fix(marca): o contraste do modo escuro mede o botão que o escuro pinta | PORTAR (limpo) |  | 6d1fab866 | — |
| #2685 | v1.79.0 | fix(automacoes): a tela desenha o funil e a etapa do gatilho de tempo (refs #2483) | NÃO SE APLICA | funil/etapa do gatilho de TEMPO no RuleEditor — gatilhos de tempo (#1540) não existem no fork | - | — |
| #2688 | v1.79.0 | fix(meta): o toque num botão de modelo entra na conversa como texto (#2688) | NÃO SE APLICA | canal oficial/intermediado/Graph — não usamos (só WAHA) | — | — |
| #2689 | v1.79.0 | fix(equipe): mostra os papéis traduzidos em vez do código interno | PORTAR (limpo) |  | db750f9a0 | — |
| #2691 | v1.80.0 | fix(worker): o /healthz enxerga o drain da IA parado (closes #2505) | PORTAR (limpo) |  | 0f581789e | — |
| #2709 | v1.80.0 | fix(followup): follow-up em espera da data do retorno deixa de ser cancelado na hora de disparar | PORTAR (limpo) |  | 7598613e4 | — |
| #2714 | v1.80.0 | chore(deps): bump the minor-and-patch group with 37 updates | ADIAR | bump de 37 dependências — risco amplo sem ganho funcional; janela própria | — | — |
| #2692 | v1.80.0 | fix(onboarding): ensaio aceita status ok, não só completed (#2686) | PORTAR (limpo) |  | ab4fe8e4d | — |
| #2541 | v1.80.0 | fix(atendimento): interrompa respostas antigas da IA quando alguém assume | ADAPTAR | portado depois do consumidor de turn_discarded (commit próprio) e do #2277; baseline com os blocos 0594 e 0615 (os de carona do upstream — módulo, cobrança, tenants, 0620, 0616 — fora); enviar-texto-fixo sem OrgNaoOperante (suspensão não portada): só o turno r | b0bd51535 | 0594,0615 |
| #2695 | v1.80.0 | fix(followup): interpola variáveis do contato e do negócio nas mensagens (#2528) | ADAPTAR | followup-turn do fork mantido (corte 0403; sem plano B de template da Meta) com contactId em resolveFlowSendBody e o corpo de message_templates renderizado com contextoDoContato; engine só com o import do renderizador. Junto: os testes do fork followup-turn-re | 9008fd88b | — |
| #2708 | v1.80.0 | fix(conexoes): agendar pausa espera o fuso da organizacao antes de gravar (#2676) | PORTAR (limpo) |  | df3f72edd | — |
| #2697 | v1.80.0 | Corrige a troca de plano com link em aberto: expira a sessao no provedor (#2609) | NÃO SE APLICA | cobrança do revendedor (Stripe/Asaas/planos) — não usamos | — | 0641 |
| #2540 | v1.80.0 | fix(crm): ordene escritas da IA no mesmo negócio | ADAPTAR | tools.ts do fork + executarEscrita no wrapMcpTool (capacidades, propostas e MCP externo do upstream fora) | a03326032 | — |
| #2717 | v1.80.0 | feat(contatos): ícone de editar na linha da tabela, ao lado de Abrir Conversa e Excluir | PORTAR (limpo) |  | 25ce3f59d | — |
| #2701 | v1.80.0 | Inbox: abas na ordem certa, busca no seletor de etiquetas e destino opcional do add_tag (#2498) | ADAPTAR | en.json resolvido pelo auto.sh; junto: components/contacts/ContactsTable.test.tsx (do #2717) sem is_personal (conversa pessoal #2391 não portada) | e101e0337 | — |
| #2741 | v1.80.0 | test(ia): o movimento que só leu é recusado pela revalidação antes da escrita | PORTAR (limpo) |  | 14652e49b | — |
| #2712 | v1.80.0 | fix(inbox): exibir contatos de vCard agrupado nas respostas | ADAPTAR | só o resolveSharedContact (LocationCard/localização e remetente de grupo não portados); teste só com o caso da citação de vCard; composer-rascunho-sugerido.test segue fora (#1611) | 4d257fe8b | — |
| #2699 | v1.80.0 | feat(prospeccao): dias da semana por conexao desamarram domingo da resposta | NÃO SE APLICA | prospecção — módulo que não usamos | — | 0642 |
| #2738 | v1.80.0 | feat(fusos): Quito e Guayaquil (Equador) na lista de fusos (de @edaben, #2102) | PORTAR (limpo) |  | fea4ebf2b | — |
| #2716 | v1.80.0 | fix(skills): cópias antigas de skill voltam a apontar o catálogo (refs #1974) | PORTAR (limpo) |  | 401463b69 | 0644 |
| #2740 | v1.80.0 | fix(midia): falha ao assinar a mídia vai para o log estruturado (recorte do #1921, de @mrmateussiilva) | PORTAR (limpo) |  | 85666f4e9 | — |
| #2720 | v1.80.0 | feat(tags): cor no momento da criação da etiqueta — nos editores de tags do contato e da conversa | PORTAR (limpo) |  | 1d7fc9fee | — |
| #2713 | main | fix(funil): o submenu Responsável do card abre inteiro e acima do menu (#2702) | PORTAR (limpo) |  | e8de0e347 | — |
| #2747 | main | fix(kit): recuperação de senha pela rede privada no single-server (substitui #2587) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2731 | main | feat(funil): troca rápida de funil dentro do quadro | ADAPTAR | seletor de funil no título + link 'Funis' do fork mantido (porta de saída da tela) | 752ff7403 | — |
| #2748 | main | fix(inbox): o comando da conversa lê o bit do contato, não duas subconsultas por linha (refs #2739) | ADAPTAR | 0645 (migration + apêndice) chamava fn_comando_da_conversa com 7 argumentos (is_group, cadeia de grupos não portada) — a função do fork tem 6 e a instalação quebraria: 7º argumento removido; teste estático da régua 0404 reancorado no cabeçalho do apêndice do f | 932768507 | 0645 |
| #2669 | main | fix(agenda): respeite o canal do serviço e a origem da reserva nos lembretes | ADIAR | remetente dos lembretes por canal do serviço (0625, 28 arquivos): construído sobre a escolha pela janela de 24h (#2595) e a suspensão (#1987), não portadas; com um número só de WhatsApp o fork já envia pelo canal certo — portar se a escola tiver vários números | - | 0625 |
| #2723 | main | feat(shell): controle de recolher a barra lateral sai do rodapé e vai para o alto — ao lado da logo (aberta) e | PORTAR (limpo) |  | 1845893c5 | — |
| #2229 | main | feat(conversas): operador exporta o historico de uma conversa em PDF (Refs 1982) | ADAPTAR | ação de auditoria conversation.exported acrescentada à lista do fork (grupos/B2B do conflito fora); traduções só as do PR; exporta-pdf sem remetente de grupo (cadeia não portada); lib/propostas/marca-da-organizacao-para-pdf.ts trazido do upstream (helper puro  | b0fe7ae2a | — |
| #2750 | main | feat(EPIC-13): GPT-6 Luna, GPT-6.1 Sol e GPT-6 Astra na lista de modelos | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | 0646 |
| #2765 | main | fix(inbox): prévia de vCard mostra o nome do contato, não o literal [contact] | ADAPTAR | só previaDaMensagem no ingest do WAHA; lib/grupos segue fora | 36a0cba9b | — |
| #2762 | main | fix(crm): criar lead direto numa etapa de perda sem motivo vira 422 lost_reason_required, não 500 | PORTAR (limpo) |  | 27e7e756d | — |
| #2752 | main | fix(lgpd): a exportação do titular é reivindicada por pedido, não por evento (closes #2751) | PORTAR (limpo) |  | d13e50774 | 0652 |
| #2782 | main | fix(followup): o STOP encerra também o follow-up pausado à mão | PORTAR (limpo) |  | 2eb82c1f8 | — |
| #2766 | main | fix(inbox): as seis abas da faixa cabem na coluna em 1280px — quebra em vez de esconder (#2745) | PORTAR (limpo) |  | 8872e6e3d | — |
| #2781 | main | fix(ia): preço do Gemini 3.6/3.7/3.8 Flash dobra em 2027-01-01 (#2563) | NÃO SE APLICA | provedor/modelo de IA que não usamos (assinatura ChatGPT, Gemini, GPT-6, OpenRouter) | — | 0649 |
| #2764 | main | fix(inbox): resposta rápida cai no display_name quando o contato não tem name | ADAPTAR | Composer: fallback do display_name + aviso de nome literal; sem o consumo de rascunho sugerido (#1611 adiado) | 78438db43 | — |
| #2768 | main | fix(EPIC-13): gravar escopo de funil e material no PATCH da versão | PORTAR (limpo) |  | 81f06d4bc | — |
| #2792 | main | test(hidratacao): a varredura parseia só o que alcança, sem teto próprio (#2792) | ADAPTAR | comentário do upstream (varredura mais rápida) | b9baa6b35 | — |
| #2763 | main | fix(kit): preflight do update manda instalar o pacote de buildx que ESTA VPS tem (#2754) | NÃO SE APLICA | kit/instalador self-host genérico — nosso deploy é scripts/deploy-vps.sh | — | — |
| #2089 | main | fix(agenda): opção de criar o Meet já com acesso aberto (issue #2063) | ADIAR | DECISÃO DO DONO: Meet com acesso aberto pede escopo novo do Google (espaços do Meet) + seção nova na política de privacidade — reautorização das contas e possível nova verificação do app Google | - | 0648 |
| #2795 | main | fix(marca): leitura de memo da instalação não reaproveita a resposta de antes da escrita | ADAPTAR | memo-da-instalacao-fora-do-dedupe-do-render.test.ts sem a entrada do CSS personalizado (lib/branding/css-personalizado não portado) | 4c8f762c1 | — |
| #2800 | main | test(e2e): a limpeza do suporte-temporario vence a recarga da aba vizinha | PORTAR (limpo) |  | a6307253d | — |
| #2790 | main | feat(funil): visão Calendário por campo de data, com mês e semana | ADAPTAR | cabeçalho do fork (link Funis + seletor de funil) + interruptor Quadro/Calendário do upstream | b74c476ae | — |
| #2767 | main | fix(auth/kit): sem SMTP o esqueci a senha diz o motivo e o aviso do update para de mandar re-rodar | PORTAR (limpo) |  | 18e895264 | — |
| #2760 | main | feat(EPIC-04): tarefas no card do negócio, com responsável e selo no quadro | ADAPTAR | LeadDossier só com as tarefas (propostas não portadas); imports de useUser/useActiveOrg/ROLE_RANK acrescentados | 230733d27 | — |
| #2805 | main | fix(banco): recusa permanente do atendimento e da agenda sai como PT409, não 40001 (diagnóstico de @paulolimaj | PORTAR (limpo) |  | 80d4fdf52 | 0654 |

## 8. Riscos residuais (validar antes da produção)

1. **Passos manuais de produção**, nenhum executado:
   - **HMAC do WAHA (#2268)**: conferir na VPS que `WAHA_HMAC_SECRET` tem ≥ 16 caracteres e que
     nenhuma `channel_sessions.webhook_secret_encrypted` tem segredo divergente; só então trocar
     `WHATSAPP_HOOK_HMAC` → `WHATSAPP_HOOK_HMAC_KEY` no compose, recriar o WAHA e conferir em
     Admin › Sistema que as entregas chegam assinadas (#2425). Só depois considerar exigir assinatura.
   - **CPF cifrado (#2551/0597)**: semear `private.app_secrets('cpf_key')` com o
     `CPF_ENCRYPTION_KEY` da VPS (≥ 32 caracteres). Sem isso nada quebra: o contato segue salvo sem
     CPF, como hoje.
   - **Webhook global do WAHA (#2618)**: a rota sem token passa a atender só a rede interna;
     conferir `WHATSAPP_HOOK_URL` do contêiner do WAHA (deve ser `http://app:3000/...`).
   - **Cron novo**: `channel-pause-scheduler` (a cada minuto) e `recover-stuck-messages` passa a
     cada 5 min — vêm na imagem do scheduler.
2. **E2E (Playwright) não executado** neste ambiente: as telas novas (Calendário do funil, troca de
   funil, divisórias, menções, PDF da conversa, pausa agendada, tarefas no card) estão cobertas por
   testes de componente, não por navegação real. Rodar o `e2e` do CI no PR.
3. **Decisões do dono** (adiadas, não implementadas): #2543 (lead pelo celular), #2089 (Meet aberto).
4. **Portes dedicados recomendados** (defeitos/valor reais, dependências grandes): custo e teto
   de gasto da leitura de imagem (#2129, depende do #2385); retenção de mídia opt-in
   (#2180/#2309/#2466/#2140); export do titular com data.json (#2427/#2651).
5. **Branch longa**: muitos commits; revisar por grupos (o histórico segue a ordem da fila).

## 9. Ferramentas e registros

Inventário, classificação, desfecho de cada PR e achados ficam em
`~/Documentos/deskcomm-checkpoints/integracao-v180/registros/` (fora do repositório); as
ferramentas da fila (`prox.sh`, `fim.sh`, `checkobj.py`, `tabela_relatorio.py`) em `ferramentas/`.
