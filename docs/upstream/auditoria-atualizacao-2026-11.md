# Integração seletiva do upstream v1.80 → v1.108 (novembro de 2026)

O upstream (`melgarafael/DeskcommCRM`) é **fonte de correções e recursos**, não o estado desejado
deste fork. Esta integração continua a de `docs/upstream/auditoria-atualizacao-2026-10.md`, com o
mesmo método e a mesma regra: **a regra da Capital Code vence**. Nada foi aplicado em produção.
Não houve merge na `main`, nem deploy. Nenhum envio de mensagem foi ligado.

## 1. Resumo

| Referência | Valor |
|---|---|
| Fork `origin/main` na partida | `d6612b96c` (PR #23) |
| Faixa do upstream avaliada | do #2805 (v1.80) ao #4466 (v1.108) |
| Branch | `integracao/upstream-v1.108` |
| Ponto de volta | tag `checkpoint/pre-upstream-v1.108-20261112T064133Z` e bundle `pre-upstream-v1.108-20261112T064133Z.bundle` (SHA256 `8321f02a…b5ca22`) |

| Desfecho dos 709 candidatos | Itens |
|---|---|
| Portados sem conflito (`limpo`) | 183 |
| Portados com adaptação (`adaptado`) | 213 |
| Adiados (`ADIAR` + `ADIADO`) | 280 |
| Não se aplicam | 80 |
| Porte dedicado (fica para PR próprio) | 6 |
| Lotes do upstream desmembrados (só os commits úteis entraram) | 8 |

A peneira automática já tinha tirado da fila 146 PRs do upstream: releases, documentação e
dependabot. A conta de 709 é o que sobrou.

- **"Adaptado"** quer dizer que o PR entrou com mudança para preservar uma regra do fork. A nota
  está na mensagem de cada commit, e este comando lista todos:
  `git log origin/main..HEAD --grep "Adaptação no fork"`.
- **Registro item a item:** em
  `deskcomm-checkpoints/integracao-v108/registros/feito.tsv`, com o PR, o desfecho, o commit e o
  motivo.

## 2. O que muda para a Capital Code

Lista do que a equipe ou o cliente vão perceber. Não é a lista completa.

**Atendimento e IA**
- **Pausa da IA garantida:** quando alguém da equipe responde pelo celular, a IA para mesmo em
  corrida. Se a pausa não puder ser gravada, fica registro na auditoria
  (`ai.pausa_nao_gravada`). Antes, a IA podia responder por cima do atendente.
- **Bolhas na ordem certa:** as mensagens de um mesmo passo do agente saem na ordem em que o modelo
  as escreveu.
- **Passagem para humano:**
  - o fail-safe só abre caso quando o cliente de fato deu sinal de querer uma pessoa;
  - o resumo do caso começa pela última fala do cliente;
  - a frase do aviso pode ser configurada na tela do agente.
- **Resumo da passagem com dados do negócio:** pode trazer campos escolhidos do card (opção por
  campo, desligada por padrão).
- **Conversa encerrada reabre** quando a mensagem do cliente chega fora de ordem (entrega atrasada
  do WhatsApp). Antes ela ficava encerrada com a mensagem dentro, fora da Fila.
- **Follow-up de IA lê o card do negócio** e não inventa combinado.
- **Custo de IA calculado** também para modelos com ponto no nome (`gpt-5.4-mini`).
- **Feriado nacional no contexto do turno:** o agente sabe que hoje é feriado.

**Inbox e funil**
- **Rolagem do Inbox:** a correção do upstream (#3209) entra no lugar da nossa (#22), como foi
  decidido.
- **Busca:** ignora acentos e continua achando pelo começo do número (nossa regra do #21).
- **Funil grande:** é lido por páginas e filtrado pela organização. Com mais de 1.000 negócios,
  antes chegava cortado sem aviso.
- **Card do funil:** mostra a hora da última mensagem.
- **Mensagens do mesmo segundo** aparecem na ordem de chegada.
- **Foto ampliada:** dá zoom de 2× no segundo clique.
- **Ao enviar:** o campo de mensagem volta ao foco.
- **Arquivos XML** podem ser anexados.

**Segurança, LGPD e operação**
- **Recusa de consentimento** gravada pela ficha bloqueia automação e campanha.
- **Cadastro "só convite":** não reabre quando outra configuração é salva.
- **Teto de tamanho nos uploads:** vale também quando o envio não declara o tamanho.
- **Guarda anti-SSRF em `media_url`:** endereço interno é recusado com 422 (seção 4).
- **Backup:** dois backups no mesmo segundo não se corrompem mais (trava por pasta). O nosso
  conserto do `.env` entre aspas continua.
- **Dreno do `event_log`:** um por vez, com trava de sessão no banco.
- **Trava de número novo (risco da v1.91):** a migration 0793 solta sozinha o número já formado na
  atualização. Ver o pós-deploy na seção 6.

## 3. Consertos nossos preservados ou trocados

| Nosso | Upstream | Decisão |
|---|---|---|
| #22 rolagem do Inbox | #3209 | Fica a do upstream |
| #21 busca pelo começo do número | #3924 (busca sem acento) | Os dois juntos (`termo-de-busca.ts`) |
| #20 ✓✓ de entrega WAHA | — | Mantido |
| #23 aviso de retenção compacto | — | Mantido |
| #12 proxy limpa cookie inválido | — | Mantido, com `x-request-id` do upstream |
| #10 backup com `.env` entre aspas | #4379 | Mantido, e entrou a trava do upstream |
| Importação de histórico (0561) | 0760/0761 | Fica a do fork. Gatilhos novos passam a ignorar `origem = 'historico'` |
| Corte de ativação 0403 ("sem agente genérico") | — | Mantido. Invariantes do upstream foram ajustados a ele |

## 4. Defeitos achados na validação e corrigidos neste PR

A `main` do fork passa no `pnpm test:db` sem nenhuma falha (2.967 casos). A branch, depois da fila,
chegou a **79 falhas**. Tudo o que a integração quebrou está corrigido aqui, em commits próprios:

1. **Instalação nova parava no meio do baseline:**
   - **Apêndices "de carona":** a resolução automática de conflito trouxe 39 blocos de migrations
     do upstream que não foram portadas (carteira, cobrança, OAuth MCP, setores…). Alguns
     redefiniam funções do núcleo. Os 39 saíram.
   - **Função cortada:** uma cópia da 0793 sem corpo engolia os blocos seguintes.
   - **Ordem dos blocos:** 0593 e 0744 estavam fora da ordem.
   - **Grants da 9037:** concediam permissão em tabelas que o fork não tem. Agora só concedem se a
     tabela existe.
2. **Colunas que o fork não tem** (`contacts.kind`, `contacts.is_personal`) em quatro lugares:
   - o índice da 0593 e o cron de nomes da agenda;
   - o **"nome informado no atendimento"**: o SQL roda em todo turno de entrada, qualquer que seja
     a opção, e teria quebrado em produção;
   - o webhook de captação.
3. **Anonimização LGPD quebrada:** a marca de apagamento (9241) lia `contact_phones`, tabela que o
   fork não tem. Era gatilho de toda anonimização. A marca volta a cobrir o telefone principal e o
   lid.
4. **Gatilho novo reagindo a histórico importado:** "mensagem do vendedor" (0686) só reconhecia
   histórico pela marca do upstream. Agora lê também a do fork.
5. **9111 sem espelho no baseline:** quem instalava do zero não recebia as FKs compostas
   organização/funil/etapa.
6. **Guarda anti-SSRF de `media_url`:** o módulo tinha vindo, mas a rota de mensagens (API pública e
   MCP) não chamava a guarda. Agora chama, com teste sabotado.
7. **i18n:** 41 frases sem espanhol foram completadas.
8. **Dependências de produção com vulnerabilidade** (`pnpm audit --prod`): ver a seção 7.

**Lição para as próximas integrações:**
- typecheck e `test:unit` verdes não provam nada sobre o banco. Os itens 1 a 5 só apareceram no
  `test:db`;
- o `baseauto.py` foi corrigido para descartar bloco de migration ausente;
- a varredura "migration nova sem menção no baseline" passa a ser rodada a cada item.

## 5. Migrations próprias novas (faixa 8xxx)

O fork passa a numerar as suas migrations na faixa **8xxx**, que o upstream não usa. Assim elas
não colidem com as futuras dele. Os dois casos atuais estão abaixo, e a decisão é do dono
(seção 8).

- **8001 — grants explícitos das 5 tabelas do fork:**
  - `avisos_temporarios` e `avisos_temporarios_historico`;
  - `feriados_de_atendimento`;
  - `org_sistema_escolar_config`;
  - `pre_matriculas`.

  Desde 30/10/2026 a Supabase não concede privilégio em tabela nova. Numa instalação nova, essas
  tabelas nasceriam inalcançáveis. Em produção o estado final é igual ao de hoje.
- **8002 — reafirma `fn_appointment_change` na forma do baseline**, para a cadeia de migrations
  chegar ao mesmo schema que a instalação. Em produção não muda nada.

## 6. Depois do deploy (conferir com o dono)

1. **Trava de número novo:** confirmar `channel_session_health.health_released_at` preenchido e a
   auditoria `channel.go_live_liberado_na_atualizacao`. Se não estiverem, liberar o número na
   Central. Sem isso, a IA fica muda.
2. **Primeira mensagem de áudio depois de um tempo parado (#3701):** o laço ocioso do `event_log`
   espera até 30 s, antes eram 10 s. Se a equipe notar demora, pôr
   `EVENT_LOG_DRAIN_IDLE_MAX_INTERVAL_MS=10000` no `.env`.
3. **Rolagem do Inbox (#3209):** provar na tela com uma conversa de 50+ mensagens recebendo
   mensagem nova.
4. **Busca:** provar na tela com `61986` e `andreia`.

## 7. Dependências

O `pnpm audit --prod` da branch, antes deste PR, apontava 2 vulnerabilidades críticas e 9 altas:

| Severidade | Pacote | Problema |
|---|---|---|
| Crítica | `@sentry/nextjs` < 10.75.2 | Bypass de middleware pela rota de túnel |
| Crítica | `proxy-addr` < 2.0.8 | Via SDK do MCP |
| Alta | `@modelcontextprotocol/sdk` < 1.32 | Corpo de requisição sem limite e outras |
| Alta | `undici` 7 < 7.30.1 | Via AI SDK |
| Alta | `zod` < 4.6.6 | |

A correção está no commit de dependências deste PR. O alinhamento geral de versões com o upstream
(Radix, ESLint 10, Sentry 11, Next 16.4.5) **não** foi feito aqui: é PR próprio, com build e
teste de tela.

## 8. Decisões pendentes do dono

1. **Retenção do traço do turno:** com o #3169 o fork passou a gravar `agent_turn_traces`, uma linha
   por execução, **sem prazo**. Também faltam as podas da 0587 (`llm_calls`, `metrics`, ledger de
   envio…). Há duas saídas:
   - portar a 0587 e o #3540 em seguida;
   - aceitar o crescimento por enquanto.

   O banco é o Nano, que já é gargalo.
2. **Faixa 8xxx** para as migrations próprias do fork (seção 5).
3. **Sugestões de configuração**, nada é automático:
   - **Aviso no WhatsApp para a equipe:** houve 89 transferências para humano em 30 dias, e o aviso
     não está configurado.
   - **Modelo próprio e mais barato para o follow-up** (ponto `followup_turn`).
   - **Prazo (`valid_until`) na memória de Black Friday**, para ela expirar sozinha.

## 9. Porte dedicado: próximos PRs, por prioridade

1. **#4323 + 0726:** RLS de negócio e conversa resolvida uma vez por consulta. No upstream, um
   funil de 3.901 negócios caiu de 3,8 s para milissegundos. Ataca o gargalo do banco.
2. **LGPD, fichas fundidas (#4384):** a anonimização não alcança a ficha que foi fundida no
   contato. A 9243 reescreve a cascata inteira; tem de ser montada sobre a do fork.
3. **#3823 + #4363:** passar a conversa entre agentes de IA, com aviso ao agente que herda. Resolve
   o defeito do agente de Alunos, que não passa a conversa ao Comercial.
4. **#4005 + #4033:** economia de tokens (registro de passos, visão de foto sob demanda, skills por
   agente, cache de prompt).
5. **Outros candidatos, com as notas em `CONTINUACAO.md`:**
   - #3841: áudio no meio do turno;
   - #3323: fechar a conversa devolvendo ao automático;
   - #3403: painel de atendimento;
   - #3525: apresentação do catálogo, que é base para o vídeo no catálogo;
   - #3965/#3995: lastro de preço;
   - #2671/#2924: "sempre atendimento humano";
   - #2929: varredura de silêncio do follow-up.

Os **adiados em bloco** ficam de fora porque a Capital Code não usa esses recursos:
- conversões de anúncio e lead ads da Meta;
- banco externo (Spec 23);
- carteira e cobrança;
- servidor MCP externo;
- ouvidoria;
- agenda por profissional e por serviço;
- pagamentos;
- status do WhatsApp;
- catálogo Claude 5.5/GPT-6.

## 10. Validação

Os números abaixo são desta branch, em 13/11/2026. O CI da PR repete tudo, em pg15 e pg17.

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | 0 erros |
| `pnpm lint` | 0 erros |
| `pnpm test:unit` (completo) | ver o comentário da PR |
| `pnpm test:db` (pg17) | Instalação e atualização com `ON_ERROR_STOP=1`; invariantes verdes (a última rodada completa acusou 2 falhas, corrigidas e reprovadas isoladas) |
| `pnpm test:shell` | ver o comentário da PR |
| `pnpm build` | ver o comentário da PR |

**Não medido nesta branch:**
- `test:db` em pg15: fica para o CI;
- e2e: fica para o CI;
- prova em tela dos itens da seção 6.
