# Triagem do CHANGELOG do upstream (melgarafael/DeskcommCRM) — status

## Contexto

Este fork divergiu muito do upstream (milhares de commits, upstream avança
~100+ commits/dia). Um merge/rebase direto é inviável — a arquitetura já
divergiu em vários pontos (agenda, cascata de LGPD, sistema escolar que só
existe aqui). A estratégia acordada com o usuário: ler o `CHANGELOG.md` do
upstream, triar cada entrada em "trazer — bug/segurança", "trazer —
hardening" ou "não trazer — feature irrelevante", e **reimplementar (não
copiar cegamente) cada item aplicável, um de cada vez**, com verificação
completa e commit próprio por item.

O changelog do upstream baixado está em `/tmp/upstream-changelog.md` (pode
não existir mais numa sessão nova — se precisar, buscar de novo via
`git show upstream/main:CHANGELOG.md` ou similar, depois de `git fetch
upstream`).

Remotes: `origin` = fork próprio; `upstream` =
`git@github.com:melgarafael/DeskcommCRM.git`.

## Itens já trazidos (commits na `main`, todos com testes verdes)

Da tier "bug/segurança", em ordem:

1. `api_audit_log` perde UPDATE/DELETE/TRUNCATE por padrão (revoke explícito)
   — migration 0277.
2. Worker publica prontidão do laço do `event_log` no `/healthz`
   (`event_log_drain`), e erro de carregamento vira `.error`, não `.warn`.
3. `reset-password.sh` volta a encontrar o usuário (bug no `filter=` da API
   admin do GoTrue).
4. Anonimização LGPD retoma de onde parou sozinha (cascata incompleta é
   varrida pelo cron de retenção, sem depender de novo clique).
5. Intervalo antes/depois do atendimento (buffer) passa a valer também na
   hora de MARCAR um novo horário, não só ao listar disponibilidade.
6. Guarda contra replay de respostas 5xx antigas do gateway do Supabase
   (`fn_pgrst_recusar_replay_do_gateway`) — migration 0278.
7. Mídia recebida pelo canal oficial da Meta (WhatsApp Cloud API) agora é
   baixada de verdade (`fetchInboundMedia` no adapter `meta-cloud`).
8. Canal `stable` das imagens Docker move em bloco, nunca por imagem
   (dormente neste fork hoje — não cortamos release numerada — mas corrigido
   preventivamente).
9. **Checagem de saúde (`/api/v1/health`) pergunta o schema certo ao
   Supabase** (`Accept-Profile: public`) — sem isso, um projeto Supabase que
   já servia outra aplicação podia fazer o `update.sh` reverter sozinho uma
   atualização bem-sucedida. Commit `5e3f12cb`.
10. **`update.sh` para a atualização quando o backup preventivo falha**, em
    vez de esperar 8s escondido no log e seguir de qualquer jeito. Expôs e
    corrigiu de quebra uma lacuna no dublê de `docker` do
    `test-validators.sh` (não criava o arquivo `waha-*.tgz` que o backup
    espera achar). Commit `d93d3f6a`.
11. **A resposta da IA não aparece mais duplicada depois de o WhatsApp
    reconectar** (e no motor WEBJS a mensagem não fica mais presa em
    `queued`, reenviada a cada tick). Causa raiz: o watchdog
    (`redriveQueued`) era o único caminho de envio que não apagava o eco da
    própria mensagem — os outros (`_handler.ts`) já chamavam
    `removerEcoDoProprioEnvio`. No WEBJS o eco grava o mesmo `_serialized`
    que o envio devolve, e o `UPDATE` esbarrava no
    `unique (organization_id, external_id)`; o `catch` tratava como erro
    transiente e a mensagem nunca saía de `queued`. Commit upstream:
    `c4585f3d7` (issue #196). Reimplementado em
    `lib/agent-engine/edge/crm/session-reconciler.ts` (+
    `wahaEchoExternalIds` em `lib/waha/message-id.ts`, delegado pelo adapter
    WAHA). Testes novos em `tests/invariants/agent-watchdog.test.ts`
    (fixtures NOWEB + WEBJS) e `tests/unit/waha-message-id.test.ts`. Commit
    `c1188d9a4`.

Cada commit tem, na própria mensagem, o commit do upstream que originou a
correção e o resultado dos testes rodados.

## Próximo item (não iniciado)

Ainda não localizado — a varredura do changelog do upstream parou no item 11.
Próximo passo ao retomar: continuar lendo `/tmp/upstream-changelog.md` (ou
buscar de novo com `git fetch upstream && git show
upstream/main:CHANGELOG.md > /tmp/upstream-changelog.md` se o arquivo não
existir mais nesta sessão) a partir de onde o item 11 foi encontrado (por
volta da linha 2204 na versão lida em 2026-09-20 — o arquivo cresce e a
numeração de linha desloca entre sessões, então buscar por texto, não por
número), em busca do PRÓXIMO item da tier "bug/segurança" ainda não triado.

## Processo para cada item (repetir)

1. Localizar o trecho exato no changelog do upstream e o commit real
   (`git log upstream/main --oneline -i --grep="..."`).
2. Ler o diff do commit upstream (`git show <sha>`) para entender a causa
   raiz e a forma exata do fix — mas **reimplementar, não copiar**: adaptar
   ao nosso código, que já divergiu em vários pontos.
3. Confirmar aplicabilidade de verdade: grep pelo código/tabela/função que o
   bug do upstream toca, no NOSSO repositório. Vários itens da tier
   "bug/segurança" já foram descartados por não se aplicarem (leak de token
   cross-tenant, feature "Zona de Perigo", limite de 69 caracteres no nome de
   sessão WAHA).
4. Implementar o fix + portar/escrever teste(s).
5. Rodar: `pnpm tsc --noEmit`, `pnpm lint` (ou eslint nos arquivos tocados),
   `pnpm test:unit` (sem caminho — é o gate real, ver `CLAUDE.md`), e
   `pnpm test:db` via `sg docker -c "pnpm test:db"` se tocar schema/RLS.
   Shell: `pnpm test:shell` se tocar `hostgator-setup-kit/`.
6. Escrever fragmento em `.changes/` e validar com `pnpm release:conferir`.
7. Commit individual, mensagem detalhada citando o commit do upstream e o
   resultado dos testes.

## Itens restantes na fila (tier bug/segurança, ainda não processados)

- Qualquer item da tier "bug/segurança" que aparecer ao continuar a
  varredura do changelog a partir de ~linha 2204 (a varredura ainda não foi
  até o fim do arquivo, que tem 7053 linhas na versão lida em 2026-09-20).

## Pendência de decisão (não re-levantada com o usuário ainda)

Depois de esgotar a tier "bug/segurança": tratar a tier "hardening/infra"
como opcional/caso a caso, e não trazer nada da tier "não trazer" (features
irrelevantes a este fork). Isso foi combinado em princípio, mas vale
reconfirmar com o usuário quando chegar lá.

## Branch auxiliar

`sync/upstream-main` existe (criada cedo nesta investigação), nunca foi usada
para merge de fato. Sem ação pendente nela a menos que o usuário peça um
sync mais amplo no futuro.
