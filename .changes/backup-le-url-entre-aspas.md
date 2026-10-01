---
impacto: nada_mudou
secao: corrigido
titulo: O backup do banco funciona com a URL entre aspas no .env
---

O script de backup do banco (`scripts/backup-db.sh`) falhava quando a URL do banco estava gravada
entre aspas no `.env` (`SUPABASE_DB_URL="postgres://…"`), que é como o instalador a grava: as aspas
iam junto para o `pg_dump`, que não reconhecia o endereço. Agora o arquivo é lido como texto —
com ou sem aspas, simples ou duplas, o valor é o mesmo — e nada dele é executado.
