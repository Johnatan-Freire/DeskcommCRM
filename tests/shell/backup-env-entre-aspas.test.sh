#!/usr/bin/env bash
# Prova de scripts/lib/env-seguro.sh e de scripts/backup-db.sh lendo a URL do .env.
#
# O defeito: o backup lia `SUPABASE_DB_URL="postgres://…"` com `grep | cut`, o
# pg_dump recebia as aspas junto, não reconhecia a URL e caía no socket local
# (medido na VPS em 2026-10-01). Os três formatos válidos — sem aspas, aspas
# duplas, aspas simples — têm de chegar ao pg_dump como o MESMO valor.
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# shellcheck source=../../scripts/lib/env-seguro.sh
. "$RAIZ/scripts/lib/env-seguro.sh"

falhas=0; casos=0
ok() { casos=$((casos + 1)); echo "  ✓ $1"; }
nok() { casos=$((casos + 1)); falhas=$((falhas + 1)); echo "  ✗ $1"; echo "     $2"; }
igual() { # igual <descrição> <obtido> <esperado>
  if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "esperado [$3], obtido [$2]"; fi
}
ler() { ler_valor_env "$TMP/.env" "$1"; }
escreve() { printf '%s\n' "$@" > "$TMP/.env"; }

URL='postgres://dono:S3nh%40com%23e%2F@db.exemplo.invalid:5432/postgres?sslmode=require'

echo "1. o parser"
escreve "DATABASE_URL=$URL";            igual "sem aspas"                    "$(ler DATABASE_URL)" "$URL"
escreve "DATABASE_URL=\"$URL\"";        igual "aspas duplas"                 "$(ler DATABASE_URL)" "$URL"
escreve "DATABASE_URL='$URL'";          igual "aspas simples"                "$(ler DATABASE_URL)" "$URL"
escreve "export DATABASE_URL=\"$URL\""; igual "export na frente"             "$(ler DATABASE_URL)" "$URL"
printf 'DATABASE_URL="%s"\r\n' "$URL" > "$TMP/.env"
igual "fim de linha CRLF" "$(ler DATABASE_URL)" "$URL"
escreve "  DATABASE_URL = \"x\"" "DATABASE_URL=\"$URL\""
igual "linha com espaço antes do = não é a chave (dotenv); vale a seguinte" "$(ler DATABASE_URL)" "$URL"
escreve "DATABASE_URL=\"$URL\"   # comentário"; igual "comentário depois de aspas" "$(ler DATABASE_URL)" "$URL"
escreve "DATABASE_URL=$URL # comentário";       igual "comentário depois de valor sem aspas" "$(ler DATABASE_URL)" "$URL"
escreve "# DATABASE_URL=postgres://comentado" "DATABASE_URL=\"$URL\""
igual "linha comentada é ignorada" "$(ler DATABASE_URL)" "$URL"
escreve 'NOME="Escola Capital Code"';  igual "espaço legítimo dentro de aspas" "$(ler NOME)" "Escola Capital Code"
escreve "NOME='a \"b\" c'";            igual "aspas duplas dentro de simples"  "$(ler NOME)" 'a "b" c'
escreve 'NOME="a \"b\" c"';            igual "aspas escapadas dentro de duplas" "$(ler NOME)" 'a "b" c'
escreve 'SENHA=abc#def';               igual "# colado no valor é dado, não comentário" "$(ler SENHA)" "abc#def"
escreve "DATABASE_URL=\"$URL\"" "DATABASE_URL=postgres://segunda"
igual "vale a primeira ocorrência" "$(ler DATABASE_URL)" "$URL"
escreve 'DATABASE_URL='
v="$(ler DATABASE_URL)"; rc=$?
if [ "$rc" = 0 ] && [ -z "$v" ]; then ok "valor vazio → vazio, sai 0"; else nok "valor vazio" "rc=$rc v=[$v]"; fi
escreve 'DATABASE_URL=""';             igual "aspas vazias → vazio" "$(ler DATABASE_URL)" ""
escreve 'OUTRA=1'
ler DATABASE_URL >/dev/null; rc=$?
if [ "$rc" = 1 ]; then ok "chave ausente → sai 1"; else nok "chave ausente" "rc=$rc"; fi
ler_valor_env "$TMP/nao-existe" DATABASE_URL >/dev/null; rc=$?
if [ "$rc" = 1 ]; then ok "arquivo ausente → sai 1"; else nok "arquivo ausente" "rc=$rc"; fi
escreve 'DATABASE_URL_X=nao' "DATABASE_URL=\"$URL\""
igual "prefixo de outra chave não casa" "$(ler DATABASE_URL)" "$URL"

echo "2. nada do .env é executado"
alvo="$TMP/foi-executado"
escreve "DATABASE_URL=\"\$(touch $alvo)\"" "OUTRA=\`touch $alvo\`"
v1="$(ler DATABASE_URL)"; v2="$(ler OUTRA)"
if [ ! -e "$alvo" ]; then ok "\$(…) e crase NÃO executam"; else nok "execução" "o arquivo $alvo foi criado"; fi
igual "\$(…) volta como texto" "$v1" "\$(touch $alvo)"

echo "3. o backup de verdade lê o .env e entrega a MESMA URL ao pg_dump"
FAKE="$TMP/bin"; mkdir -p "$FAKE"
cat > "$FAKE/pg_dump" <<'SH'
#!/usr/bin/env bash
printf '%s' "$1" > "$PG_DUMP_URL_RECEBIDA"
for a in "$@"; do case "$a" in --file=*) : > "${a#--file=}" ;; esac; done
SH
chmod +x "$FAKE/pg_dump"
for formato in sem duplas simples; do
  REPO="$TMP/repo-$formato"; mkdir -p "$REPO/scripts/lib"
  cp "$RAIZ/scripts/backup-db.sh" "$REPO/scripts/"; cp "$RAIZ/scripts/lib/env-seguro.sh" "$REPO/scripts/lib/"
  case "$formato" in
    sem) printf 'SUPABASE_DB_URL=%s\n' "$URL" > "$REPO/.env" ;;
    duplas) printf 'SUPABASE_DB_URL="%s"\n' "$URL" > "$REPO/.env" ;;
    simples) printf "SUPABASE_DB_URL='%s'\n" "$URL" > "$REPO/.env" ;;
  esac
  recebida="$TMP/url-$formato"
  saida="$(env -u SUPABASE_DB_URL -u SUPABASE_DB_ADMIN_URL PATH="$FAKE:$PATH" PG_DUMP_URL_RECEBIDA="$recebida" \
    bash "$REPO/scripts/backup-db.sh" "$TMP/dumps-$formato" 2>&1)"; rc=$?
  if [ "$rc" = 0 ]; then ok "aspas $formato: o backup termina"; else nok "aspas $formato: o backup termina" "rc=$rc"; fi
  igual "aspas $formato: o pg_dump recebe a URL sem aspas" "$(cat "$recebida" 2>/dev/null)" "$URL"
  case "$saida" in *S3nh*|*dono:*) nok "aspas $formato: a saída não mostra a senha" "a saída contém o segredo" ;;
    *) ok "aspas $formato: a saída não mostra a senha" ;; esac
done
REPO="$TMP/repo-vazio"; mkdir -p "$REPO/scripts/lib"
cp "$RAIZ/scripts/backup-db.sh" "$REPO/scripts/"; cp "$RAIZ/scripts/lib/env-seguro.sh" "$REPO/scripts/lib/"
printf 'OUTRA=1\n' > "$REPO/.env"
env -u SUPABASE_DB_URL -u SUPABASE_DB_ADMIN_URL PATH="$FAKE:$PATH" PG_DUMP_URL_RECEBIDA="$TMP/nada" \
  bash "$REPO/scripts/backup-db.sh" "$TMP/dumps-vazio" >/dev/null 2>&1; rc=$?
if [ "$rc" != 0 ] && [ ! -e "$TMP/nada" ]; then ok "sem URL no .env: falha fechada, pg_dump nem é chamado"; else nok "sem URL" "rc=$rc"; fi

echo
if [ "$falhas" = 0 ]; then echo "backup-env-entre-aspas: $casos casos, todos verdes"; exit 0; fi
echo "backup-env-entre-aspas: $falhas de $casos casos vermelhos"; exit 1
