#!/usr/bin/env bash
# Backs up the database and uploaded files into ./backups, keeps the newest 14, and (optionally) copies the newest to a second place.
#   ./scripts/backup.sh                       # run by hand
#   0 2 * * * cd /path/to/project && ./scripts/backup.sh >> backups/backup.log 2>&1     # every night at 2 am (crontab -e)
# Optional: BACKUP_COPY_TO="user@other-server:/backups/"  (any rsync destination) to keep an off-server copy.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U school -d school --format=custom > "backups/db-$stamp.dump"
docker compose exec -T app tar -C /data -czf - storage > "backups/files-$stamp.tar.gz"
[ -s "backups/db-$stamp.dump" ] || { echo "Backup failed: database dump is empty" >&2; exit 1; }
ls -1t backups/db-*.dump | tail -n +15 | xargs -r rm --
ls -1t backups/files-*.tar.gz | tail -n +15 | xargs -r rm --
[ -n "${BACKUP_COPY_TO:-}" ] && rsync -a "backups/db-$stamp.dump" "backups/files-$stamp.tar.gz" "$BACKUP_COPY_TO"
echo "$(date -Is) backup ok: db-$stamp.dump files-$stamp.tar.gz"
