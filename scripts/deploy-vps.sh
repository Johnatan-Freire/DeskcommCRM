#!/usr/bin/env bash
# Deploy do fork na VPS: reaplica o schema e sobe as imagens novas.
#
# Chamado pelo `.github/workflows/deploy.yml` por SSH, DEPOIS do `git reset`
# para o topo da `main` — então este arquivo já é a versão nova quando roda.
# Mora num arquivo, e não inline no workflow, porque o bloco do `ssh` é uma
# string entre aspas simples: a conferência das regras de isolamento (awk com
# aspas) não cabe lá sem escapes ilegíveis, e aqui ela é testável
# (`tests/shell/deploy-vps.test.sh`).
#
# ── POR QUE O SISTEMA PARA ANTES DO BANCO ───────────────────────────────────
#
# Medido em 2026-09-26: as duas rodadas do deploy morreram em `deadlock
# detected` nas três passadas do `reaplicar_baseline` — app, worker e
# scheduler seguiam no ar disputando lock com o `drop/create policy` do
# baseline. O `update.sh` do kit já aprendeu isso (113 travamentos com tudo de
# pé, 0 com o sistema parado) e PAUSA o que fala com o banco; este deploy
# chamava o mesmo `reaplicar_baseline` sem a pausa. Pior que falhar: um
# deadlock entre o `drop policy` e o `create policy` da mesma regra deixa a
# tabela SEM regra de isolamento, e a tela mostra vazio sem erro nenhum.
#
# ── POR QUE SÓ PARA QUANDO O SCHEMA MUDA ────────────────────────────────────
#
# Cada passada do baseline leva ~8-11 min contra o Supabase Cloud (medido nos
# logs do deploy). Parar o CRM esse tempo a cada merge — inclusive os que só
# mexem em tela — é derrubar o atendimento sem motivo. O hash do
# `baseline.sql` aplicado com sucesso fica gravado; igual → nada a aplicar,
# nenhuma pausa. A marca só é gravada no SUCESSO completo, então uma rodada
# que falhou é refeita na próxima.
#
# ── A ORDEM ─────────────────────────────────────────────────────────────────
#
#   1. puxa as imagens COM o sistema no ar (baixar não troca contêiner);
#   2. se o schema mudou: manutenção no ar, para app/worker/scheduler,
#      reaplica, confere as regras de isolamento;
#   3. `up -d` com as imagens novas.
#
# Falha no passo 2 (fail-closed): nada novo sobe. Erro de schema → os
# contêineres ANTIGOS voltam (`start`, não `up`: `up` recriaria com a imagem
# nova, já baixada no passo 1). Regra de isolamento faltando → o CRM fica
# PARADO com a página de manutenção, de propósito: CRM no ar sem regra mostra
# tela vazia para todo mundo, e isso é pior do que fora do ar.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# `manutencao_sobe` acha a página por aqui; quem a define no kit é o update.sh.
KIT_DIR="$PWD/hostgator-setup-kit"
# shellcheck source=hostgator-setup-kit/_common.sh
source hostgator-setup-kit/_common.sh
# shellcheck source=hostgator-setup-kit/manutencao.sh
source hostgator-setup-kit/manutencao.sh
enter_project

SERVICOS=(app worker scheduler)
dcp() { docker compose -f "$COMPOSE" "$@"; }

MARCA="${DEPLOY_MARCA_DO_BASELINE:-$PROJECT_DIR/.deploy-baseline-aplicado.sha256}"
LOG_DO_BANCO="${DEPLOY_LOG_DO_BANCO:-/tmp/deploy-baseline.log}"
BASELINE="$PROJECT_DIR/supabase/baseline.sql"

# Regras que o baseline TERMINA criando (vale a última operação de cada regra
# no arquivo — o baseline cria e depois apaga de propósito em vários pontos) e
# que não existem no banco. Mesma régua do `update.sh`.
regras_de_isolamento_faltando() {
  local esperadas existentes
  esperadas="$(awk '
    match($0, /drop policy if exists "?[a-zA-Z0-9_]+"? on public\.[a-zA-Z0-9_]+/) {
      linha = substr($0, RSTART, RLENGTH); acao = "drop"
    }
    match($0, /create policy "?[a-zA-Z0-9_]+"? on public\.[a-zA-Z0-9_]+/) {
      linha = substr($0, RSTART, RLENGTH); acao = "create"
    }
    acao != "" {
      gsub(/.*policy (if exists )?"?/, "", linha); gsub(/"? on public\./, "|", linha)
      estado[linha] = acao; acao = ""
    }
    END { for (k in estado) if (estado[k] == "create") print k }
  ' "$BASELINE" | sort -u)"
  # Sem `2>/dev/null || true`: uma consulta que falha tem de derrubar o deploy,
  # e não virar "zero regras existentes" (que reprovaria) nem "nada faltando".
  existentes="$(pg_container -i postgres:17-alpine psql "$(url_do_schema)" -X -t -A -F'|' -c \
    "select p.polname, c.relname from pg_policy p join pg_class c on c.oid=p.polrelid
       join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';" | sort -u)"
  comm -23 <(printf '%s\n' "$esperadas") <(printf '%s\n' "$existentes") | sed '/^$/d'
}

# Estado do que foi parado, lido pelo trap.
#   ""        → nada parado (ou já religado)
#   antigos   → saída inesperada: religa os contêineres antigos
#   parado    → regra faltando: fica parado, com a manutenção no ar
PAUSA=""
ao_sair() {
  case "$PAUSA" in
    antigos)
      echo "::warning::deploy interrompido — religando os contêineres ANTIGOS (nenhuma imagem nova subiu)"
      manutencao_desce
      dcp start "${SERVICOS[@]}" || true ;;
    parado)
      echo "::error::CRM segue PARADO de propósito (página de manutenção no ar): recrie as regras de isolamento listadas acima e rode 'docker compose -f $COMPOSE up -d ${SERVICOS[*]}'" ;;
  esac
}
trap ao_sair EXIT INT TERM HUP

dcp pull "${SERVICOS[@]}"
# A página de manutenção roda em nginx; baixá-lo agora, com tudo no ar, tira o
# download da janela em que o CRM está parado.
docker pull -q nginx:alpine >/dev/null 2>&1 || true

hash_novo="$(sha256sum "$BASELINE" | cut -d' ' -f1)"
hash_aplicado="$(cat "$MARCA" 2>/dev/null || true)"

if [ "$hash_novo" = "$hash_aplicado" ]; then
  echo "✓ baseline.sql idêntico ao último aplicado com sucesso — schema não muda, o sistema não para"
else
  echo "• baseline.sql mudou — pausando app/worker/scheduler para reaplicar sem disputa de lock"
  PAUSA=antigos
  manutencao_sobe
  dcp stop "${SERVICOS[@]}"

  pg_container postgres:17-alpine psql "$(url_do_schema)" -c \
    "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;" \
    >/dev/null 2>&1 || true

  # Caminho ABSOLUTO: `reaplicar_baseline` monta o arquivo como volume, e o
  # Docker lê caminho relativo como NOME de volume (medido em 2026-09-26).
  if reaplicar_baseline "$BASELINE" "$LOG_DO_BANCO"; then
    echo "✓ baseline reaplicado sem erro real de schema (passadas: $BASELINE_PASSADAS)"
  else
    echo "::error::baseline.sql reaplicado com ERRO REAL de schema — deploy interrompido ANTES de subir os contêineres novos:"
    printf '%s\n' "$BASELINE_INESPERADO" | head -20 || true
    exit 1
  fi

  faltando="$(regras_de_isolamento_faltando)"
  if [ -n "$faltando" ]; then
    PAUSA=parado
    echo "::error::regras de isolamento (RLS) FALTANDO depois do baseline:"
    printf '  • %s\n' $faltando
    exit 1
  fi
  echo "✓ regras de isolamento conferidas: nenhuma faltando"

  printf '%s\n' "$hash_novo" > "$MARCA"
  manutencao_desce
fi

dcp up -d "${SERVICOS[@]}"
PAUSA=""
echo "✓ app/worker/scheduler no ar com as imagens novas"
