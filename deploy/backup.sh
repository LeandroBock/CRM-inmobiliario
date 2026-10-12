#!/bin/sh
# Backup diario de la base con pg_dump (formato comprimido de PostgreSQL). Corre al arrancar y después cada 24 h.
# Se guardan los últimos BACKUP_KEEP_DAYS días en /backups (./backups en el servidor).
set -u
KEEP="${BACKUP_KEEP_DAYS:-14}"

until pg_isready -q; do sleep 5; done

while true; do
  file="/backups/crm-$(date -u +%Y%m%d-%H%M).dump"
  # Se escribe a un .part y se renombra al final: nunca queda un backup a medias con nombre de bueno.
  if pg_dump --format=custom --file="$file.part"; then
    mv "$file.part" "$file"
    echo "$(date -u) backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "$(date -u) ERROR: falló el backup" >&2
  fi
  find /backups -name 'crm-*.dump' -mtime +"$KEEP" -delete
  sleep 86400
done
