#!/usr/bin/env bash
# Backup de la base a un bucket S3/R2 (lo usa .github/workflows/backup-db.yml; también se puede correr a mano).
# Guarda solo el esquema "public" (los datos del CRM; en Supabase el resto son tablas internas de Supabase)
# en formato comprimido de pg_dump, en backups/ del bucket privado, y borra los de más de KEEP_DAYS días.
#
# Variables: DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PRIVATE_BUCKET, KEEP_DAYS (30)
# Necesita docker (para pg_dump 17, que sirve para bases 15 a 17) y node con las dependencias instaladas (npm ci).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Falta DATABASE_URL}" "${S3_PRIVATE_BUCKET:?Falta S3_PRIVATE_BUCKET}"
KEEP_DAYS="${KEEP_DAYS:-30}"
PG_IMAGE="${PG_IMAGE:-postgres:17.6-alpine}"

# Conexión cifrada salvo que la URL ya diga otra cosa (las bases en la nube la exigen)
url="$DATABASE_URL"
[[ "$url" == *sslmode=* ]] || url="${url}$([[ "$url" == *\?* ]] && echo '&' || echo '?')sslmode=require"

work="$(mktemp -d "${TMPDIR:-/tmp}/crm-backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
name="crm-$(date -u +%Y%m%d-%H%M).dump"

echo "Generando $name..."
docker run --rm -e PGCONNECT_TIMEOUT=20 "$PG_IMAGE" \
  pg_dump "$url" --schema=public --no-owner --no-privileges --format=custom > "$work/$name"
# Un dump válido del formato custom empieza con "PGDMP"
if [[ "$(head -c 5 "$work/$name")" != "PGDMP" ]]; then
  echo "ERROR: el archivo generado no es un backup válido" >&2
  exit 1
fi
echo "Tamaño: $(du -h "$work/$name" | cut -f1)"

node deploy/backup-bucket.mjs upload "$work/$name" "backups/$name"
node deploy/backup-bucket.mjs rotate backups/crm- "$KEEP_DAYS"
echo "Listo."
