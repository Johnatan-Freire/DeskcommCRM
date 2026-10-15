# Implantação — agentes da escola (CRM PR #19 + sistema escolar PR #40)

**Escrito em 15/10/2026.** Nada aqui foi executado; cada passo marcado **[aprovação]** espera o dono.

## 0. O que o merge faz sozinho (leia antes de clicar)

| Repositório | Ao mesclar na `main` | Aprovação no GitHub? |
|---|---|---|
| `sistemaEscolar` (#40) | job **Build & Deploy Laravel** implanta em produção | **não** (environment `production` sem revisores) |
| `DeskcommCRM` (#19) | publica as 3 imagens → **Deploy automático (VPS)** → reaplica o baseline com o CRM em manutenção (~10 min) | **não** |

Mesclar = implantar. Escolha o horário antes de clicar.

## 1. Ordem e retrocompatibilidade

**Sistema escolar primeiro, CRM depois.** Conferido no código:

- **Laravel novo + CRM atual (em produção, `2f29d4f`):** o CRM atual chama `/aluno` sem data, recebe `alunos: []` e
  trata como "nenhum aluno encontrado". O agente acadêmico está pausado, então nada muda para ninguém. A
  identidade escolar (mover card para etapa acadêmica) só roda em turno de agente — pausado, não roda.
- **CRM novo + Laravel atual:** o CRM novo exige `confirmacao` na resposta; sem ela devolve
  `api_sem_confirmacao` e passa para a equipe — nenhum dado sai. Também seguro.
- O **segundo fator** (código por e-mail) nasce **desligado** (`DESKCOMM_CONFIRMACAO_POR_CODIGO` ausente = false).

## 2. Antes (só leitura, ~10 min)

1. `gh pr checks 19` e `gh pr checks 40`: tudo verde (CRM: verify, invariants pg15/pg17, e2e 5 partes, build, imagens-ok).
2. Backup lógico do banco (Estocolmo), só leitura: `bash /root/migracao-stockholm/backup-stockholm.sh` na VPS.
   Confira a pasta nova e o `SHA256SUMS`.
3. Estado que **não pode mudar** com o deploy (anote para comparar depois):
   - 2 agentes pausados, nenhum publicado, `service_enabled_at` vazio;
   - 0 follow-ups ativos;
   - `OUTBOUND_MESSAGING` ausente nos 3 contêineres (`docker exec crm-app-1 printenv OUTBOUND_MESSAGING` → vazio).
4. Horário de pouco movimento (o CRM fica ~10 min em manutenção; o WhatsApp continua recebendo e o WAHA
   reenvia o que chegar durante a janela).

## 3. Implantação **[aprovação]**

1. Mesclar o **#40** (sistema escolar). Esperar o job "Build & Deploy Laravel" terminar verde.
   Prova: `GET /api/deskcomm/aluno?telefone=<número de teste>` sem data responde com `"confirmacao":"nao_informada"`
   (ou `encontrado:false`) — **nunca** com notas.
2. Mesclar o **#19** (CRM). Acompanhar "Publicar imagem Docker" → "Deploy automático (VPS)".
   O log do deploy precisa mostrar "baseline reaplicado sem erro real de schema" e "regras de isolamento
   conferidas: nenhuma faltando".

**Migrations que entram (aditivas):** 0657 (pausa global de follow-ups), 0658 (avisos temporários),
0659 (pré-matrículas), 0660 (feriados). Nenhuma apaga ou reescreve dado existente.

## 4. Depois (~15 min)

- Domínio responde **307**; `/api/v1/health` com a versão nova e Supabase/Redis/WAHA `ok`.
- Logs sem `statement timeout`/`57014` nos 15 minutos seguintes.
- **O estado do item 2.3 continua igual** (agentes pausados, 0 follow-ups, `OUTBOUND_MESSAGING` ausente).
- Telas: IA › Avisos temporários, Atendimento › Pré-matrículas, Equipe › Atendimento (feriados), IA › Agentes
  (Pausar/Retomar todos), IA › Follow-ups (chave geral), IA › Provedores (aviso de modelo padrão incoerente).

## 5. Rollback

- **Aplicação:** voltar app/worker/scheduler às imagens `deskcomm-preserve:*-rollback-*` que o `deploy-vps.sh`
  guarda antes de trocar (`docker compose ... up -d` com `APP_IMAGE`/`WORKER_IMAGE`/`SCHEDULER_IMAGE` apontando
  para elas).
- **Schema: NÃO volta com a imagem.** As tabelas/colunas/funções das 0657–0660 ficam. Elas são aditivas e a
  imagem anterior convive com elas: as funções de follow-up alteradas só mudam de comportamento com a pausa
  global LIGADA (ninguém liga sem a tela nova); as tabelas novas ficam sem uso.
- **Desfazer o schema** exigiria migration nova (forward-fix) — não há `down`. Só se houver motivo concreto.
- **Laravel:** reverter o merge do #40 e implantar de novo (o `rollback.yml` do repositório).
- Backup do item 2.2 é a rede de última instância para dados.

## 6. O que fica para depois do deploy (não faz parte dele)

Configurações de produção, cada uma com aprovação própria — ver o relatório final:
agenda da Maria Laura, feriados, modelo padrão de IA, mensagem parada desde 08/10, compute do Supabase,
publicação dos prompts, teste controlado com números internos.
