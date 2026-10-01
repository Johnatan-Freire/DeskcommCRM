#!/usr/bin/env bash
# Leitura SEGURA de uma chave de um arquivo .env — sem `source`, sem `eval`.
#
# Por que existe: `scripts/backup-db.sh` lia a URL com `grep | cut`, e o valor
# vinha com as aspas do .env (`SUPABASE_DB_URL="postgres://…"`). O pg_dump
# recebia `"postgres://…"` literal, não reconhecia como URL, tentava o socket
# local e falhava (medido na VPS de produção em 2026-10-01). `source .env`
# resolveria as aspas, mas EXECUTA o arquivo: um valor com `$(…)` ou crase
# viraria comando. Aqui o arquivo é só TEXTO.
#
# Regras (as do dotenv usual):
#   - linha em branco e linha que começa com `#` são ignoradas;
#   - `export CHAVE=valor` vale como `CHAVE=valor`; CRLF é tolerado;
#   - "aspas duplas": o valor vai até a próxima aspa dupla não escapada;
#     `\"` e `\\` viram `"` e `\`; o que vier depois (ex.: comentário) é ignorado;
#   - 'aspas simples': literal até a próxima aspa simples;
#   - sem aspas: espaços das pontas saem, e um ` #` (espaço + cerquilha) começa
#     comentário — `#` colado no valor é dado (ex.: dentro de uma URL);
#   - nada é decodificado: senha percent-encoded segue como está, que é o que a
#     URL do Postgres espera;
#   - vale a PRIMEIRA ocorrência da chave (o comportamento de antes do script).
#
# Uso:   ler_valor_env <arquivo> <CHAVE>
#   imprime o valor (sem quebra de linha) e sai 0; sai 1 se o arquivo ou a chave
#   não existem. Valor vazio sai 0 e imprime nada.

ler_valor_env() {
  local arquivo="$1" chave="$2" linha valor saida c i
  [ -f "$arquivo" ] || return 1
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha="${linha%$'\r'}"
    linha="${linha#"${linha%%[![:space:]]*}"}"
    case "$linha" in '' | '#'*) continue ;; esac
    case "$linha" in
      "export "*) linha="${linha#export }"; linha="${linha#"${linha%%[![:space:]]*}"}" ;;
    esac
    case "$linha" in "$chave="*) ;; *) continue ;; esac
    valor="${linha#"$chave="}"
    valor="${valor#"${valor%%[![:space:]]*}"}"
    case "$valor" in
      \"*)
        valor="${valor#\"}"
        saida=""
        for ((i = 0; i < ${#valor}; i++)); do
          c="${valor:i:1}"
          if [ "$c" = "\\" ] && [ $((i + 1)) -lt ${#valor} ]; then
            saida+="${valor:i+1:1}"
            i=$((i + 1))
          elif [ "$c" = '"' ]; then
            break
          else
            saida+="$c"
          fi
        done
        valor="$saida"
        ;;
      \'*)
        valor="${valor#\'}"
        valor="${valor%%\'*}"
        ;;
      *)
        valor="${valor%%[[:space:]]#*}"
        valor="${valor%"${valor##*[![:space:]]}"}"
        ;;
    esac
    printf '%s' "$valor"
    return 0
  done < "$arquivo"
  return 1
}
