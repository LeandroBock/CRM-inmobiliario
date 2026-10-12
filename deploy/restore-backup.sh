#!/usr/bin/env bash
# Restaura un backup hecho con deploy/backup-to-s3.sh. REEMPLAZA todos los datos del CRM en la base destino.
#
#   deploy/restore-backup.sh crm-AAAAMMDD-HHMM.dump "postgresql://...(Session pooler de Supabase)..." --si-borrar-todo
#
# Antes: frenar la API (en Render: Suspend) para que nadie escriba durante la restauración; después, reanudarla.
# Necesita docker.
set -euo pipefail

file="${1:?Uso: restore-backup.sh <archivo.dump> <DATABASE_URL> --si-borrar-todo}"
url="${2:?Falta la DATABASE_URL de destino}"
if [[ "${3:-}" != "--si-borrar-todo" ]]; then
  echo "Esto reemplaza TODOS los datos del CRM en la base destino. Para confirmar, agregá --si-borrar-todo al final." >&2
  exit 1
fi
[[ "$(head -c 5 "$file")" == "PGDMP" ]] || { echo "ERROR: $file no es un backup válido" >&2; exit 1; }
PG_IMAGE="${PG_IMAGE:-postgres:17.6-alpine}"
[[ "$url" == *sslmode=* ]] || url="${url}$([[ "$url" == *\?* ]] && echo '&' || echo '?')sslmode=require"

dir="$(cd "$(dirname "$file")" && pwd)"
base="$(basename "$file")"
run() { docker run --rm -v "$dir:/backup:ro" -w /backup "$PG_IMAGE" "$@"; }

# El esquema "public" no se borra ni se recrea: de él dependen PostGIS y uuid-ossp. Se borran las tablas y tipos del
# CRM (no los de las extensiones, como spatial_ref_sys), así la base queda exactamente como en el backup aunque
# después se hayan agregado tablas nuevas.
run psql "$url" -v ON_ERROR_STOP=1 -q -c "
DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT c.oid::regclass AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE 'DROP TABLE IF EXISTS ' || r.t || ' CASCADE'; END LOOP;
  FOR r IN SELECT t.oid::regtype AS ty FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP EXECUTE 'DROP TYPE IF EXISTS ' || r.ty || ' CASCADE'; END LOOP;
END \$\$;"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
run sh -c "pg_restore -l '$base' | grep -v ' SCHEMA - public ' > /tmp/lista && \
  pg_restore --clean --if-exists --no-owner --no-privileges -L /tmp/lista -d '$url' '$base'" > "$log" 2>&1 || true

# Único error esperable: un pg_dump 17 restaurado en una base 15/16 no conoce "transaction_timeout" (no afecta).
errors="$(grep '^pg_restore: error:' "$log" | grep -cv 'transaction_timeout' || true)"
if [[ "$errors" != "0" ]]; then
  cat "$log" >&2
  echo "ERROR: la restauración tuvo $errors error(es). Revisá los mensajes de arriba antes de volver a prender la API." >&2
  exit 1
fi
users="$(run psql "$url" -tAc 'SELECT count(*) FROM users WHERE email IS NOT NULL')"
echo "Restaurado sin errores. Usuarios en la base: $users"
