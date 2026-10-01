#!/usr/bin/env bash
# Backup do Postgres (Supabase) do DeskcommCRM — schema public completo
# (CRM + harness do agente). Roda no host ou num cron da VPS:
#   0 3 * * * /path/repo/scripts/backup-db.sh /var/backups/deskcomm
# Requer: pg_dump no PATH (major compatível) e a conexão do DONO no .env/.env.local — com a do app o dump sai parcial e sai verde.
set -euo pipefail

DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Leitura do .env sem `source` (que executaria o arquivo) e sem `grep | cut`
# (que trazia as aspas junto — `"postgres://…"` não é URL para o pg_dump, que
# então tentava o socket local e falhava). Ver scripts/lib/env-seguro.sh.
# shellcheck source=lib/env-seguro.sh
. "$ROOT/scripts/lib/env-seguro.sh"

URL="${SUPABASE_DB_ADMIN_URL:-${SUPABASE_DB_URL:-}}"
if [ -z "$URL" ]; then
  for f in "$ROOT/.env.local" "$ROOT/.env"; do
    if [ -f "$f" ]; then
      URL=$(ler_valor_env "$f" SUPABASE_DB_ADMIN_URL || true)
      if [ -z "$URL" ]; then URL=$(ler_valor_env "$f" SUPABASE_DB_URL || true); fi
      [ -n "$URL" ] && break
    fi
  done
fi
[ -n "$URL" ] || { echo "FATAL: SUPABASE_DB_ADMIN_URL/SUPABASE_DB_URL ausente (env ou .env/.env.local)" >&2; exit 1; }

mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/deskcomm-$STAMP.dump"
pg_dump "$URL" --format=custom --schema=public --no-owner --no-privileges --file="$OUT"
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"

# retenção: apaga dumps mais velhos que RETENTION_DAYS
find "$DIR" -name 'deskcomm-*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "retenção aplicada (${RETENTION_DAYS}d)"
