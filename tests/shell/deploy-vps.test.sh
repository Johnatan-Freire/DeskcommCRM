#!/usr/bin/env bash
# Prova de `scripts/deploy-vps.sh` (o passo remoto do deploy.yml), com `docker`
# substituído por um dublê que registra cada chamada e responde o psql.
#
#   bash tests/shell/deploy-vps.test.sh
#
# O defeito, medido em 2026-09-26: o deploy reaplicava o baseline com app,
# worker e scheduler no ar e morreu em `deadlock detected` nas três passadas.
#
# O que está sob prova:
#   1. baseline mudou → PARA app/worker/scheduler ANTES de aplicar, e só sobe
#      (`up -d`) depois; a marca do baseline é gravada;
#   2. baseline igual ao último aplicado → não para nada e não aplica nada;
#   3. erro real de schema → nenhum `up -d`; os contêineres ANTIGOS voltam por
#      `start`; a marca NÃO é gravada (a próxima rodada tenta de novo);
#   4. regra de isolamento faltando depois do baseline → nenhum `up -d` e nenhum
#      `start`: o CRM fica parado de propósito;
#   5. as imagens são puxadas ANTES da pausa (baixar fora da janela parada).
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
check() {  # check <descrição> <comando de verificação...>
  if "${@:2}"; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); fi
}

# ── Dublê de `docker` ────────────────────────────────────────────────────────
#   baseline (`-f /b.sql`)  → imprime $ROTEIRO/baseline (vazio = limpo)
#   consulta de pg_policy   → imprime $ROTEIRO/policies
#   o resto                 → só registra
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case " $* " in
  *" -f /b.sql "*) cat "$ROTEIRO/baseline" 2>/dev/null; exit 0 ;;
  *pg_policy*)     cat "$ROTEIRO/policies" 2>/dev/null; exit 0 ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/docker"

# Projeto falso com o script e o kit REAIS.
PROJ="$WORK/proj"
mkdir -p "$PROJ/scripts" "$PROJ/supabase"
cp "$RAIZ/scripts/deploy-vps.sh" "$PROJ/scripts/"
cp -r "$RAIZ/hostgator-setup-kit" "$PROJ/"
: > "$PROJ/docker-compose.prod.yml"
printf 'SUPABASE_DB_URL=postgres://u:p@db.invalid:5432/postgres\nREVERSE_PROXY=caddy\n' > "$PROJ/.env"
cat > "$PROJ/supabase/baseline.sql" <<'SQL'
drop policy if exists leads_select on public.crm_leads;
create policy leads_select on public.crm_leads for select using (true);
drop policy if exists velha on public.crm_leads;
SQL

MARCA="$WORK/marca"
novo_caso() {
  ROTEIRO="$WORK/roteiro.$1"; rm -rf "$ROTEIRO"; mkdir -p "$ROTEIRO"
  DOCKER_LOG="$WORK/docker.$1.log"; : > "$DOCKER_LOG"
  printf 'leads_select|crm_leads\n' > "$ROTEIRO/policies"
  export ROTEIRO DOCKER_LOG
}
rodar() {
  PATH="$WORK/bin:$PATH" DEPLOY_MARCA_DO_BASELINE="$MARCA" DEPLOY_LOG_DO_BANCO="$WORK/banco.log" \
    BASELINE_ESPERA_S=0 bash "$PROJ/scripts/deploy-vps.sh" > "$WORK/saida.log" 2>&1
}
linha() { grep -nE -- "$1" "$DOCKER_LOG" | head -1 | cut -d: -f1; }
antes() { local a b; a="$(linha "$1")"; b="$(linha "$2")"; [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; }
tem() { grep -qE -- "$1" "$DOCKER_LOG"; }
nao_tem() { ! grep -qE -- "$1" "$DOCKER_LOG"; }

echo "1. baseline mudou → pausa, aplica, confere, sobe"
novo_caso mudou; rm -f "$MARCA"
rodar; rc=$?
check "sai 0" [ "$rc" -eq 0 ]
check "puxa as imagens antes de parar" antes "compose .* pull app worker scheduler" "compose .* stop app worker scheduler"
check "para antes de aplicar o baseline" antes "compose .* stop app worker scheduler" "-f /b.sql"
check "confere as regras depois do baseline" antes "-f /b.sql" "pg_policy"
check "sobe (up -d) só depois da conferência" antes "pg_policy" "compose .* up -d app worker scheduler"
check "sobe a página de manutenção durante a pausa" tem "run .*--name deskcomm-manutencao"
check "grava a marca com o hash do baseline" [ "$(cat "$MARCA" 2>/dev/null)" = "$(sha256sum "$PROJ/supabase/baseline.sql" | cut -d' ' -f1)" ]

echo "2. baseline igual ao último aplicado → nada para, nada aplica"
novo_caso igual
rodar; rc=$?
check "sai 0" [ "$rc" -eq 0 ]
check "não para nenhum serviço" nao_tem " stop "
check "não aplica o baseline" nao_tem "-f /b.sql"
check "ainda sobe as imagens novas" tem "compose .* up -d app worker scheduler"

echo "3. erro real de schema → contêineres antigos voltam, nada novo sobe"
novo_caso erro; rm -f "$MARCA"
printf 'psql:/b.sql:10: ERROR:  column "x" does not exist\n' > "$ROTEIRO/baseline"
rodar; rc=$?
check "sai diferente de 0" [ "$rc" -ne 0 ]
check "nenhum up -d" nao_tem " up -d"
check "religa os antigos com start" tem "compose .* start app worker scheduler"
check "não grava a marca" [ ! -f "$MARCA" ]
check "o erro aparece na saída" grep -q 'column "x" does not exist' "$WORK/saida.log"

echo "4. regra de isolamento faltando → CRM fica parado"
novo_caso sem-regra; rm -f "$MARCA"
: > "$ROTEIRO/policies"
rodar; rc=$?
check "sai diferente de 0" [ "$rc" -ne 0 ]
check "nenhum up -d" nao_tem " up -d"
check "nenhum start" nao_tem " start "
check "nomeia a regra que falta" grep -q 'leads_select|crm_leads' "$WORK/saida.log"
check "não cobra regra que o baseline termina apagando" bash -c "! grep -q 'velha|crm_leads' '$WORK/saida.log'"
check "não grava a marca" [ ! -f "$MARCA" ]

if [ "$FAILS" -gt 0 ]; then printf '\n%s verificação(ões) falharam\n' "$FAILS"; exit 1; fi
printf '\ntodas as verificações passaram\n'
