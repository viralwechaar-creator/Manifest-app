#!/usr/bin/env bash
# Restores a database backup made by backup.sh.   ./scripts/restore.sh backups/db-YYYYMMDD-HHMMSS.dump
# WARNING: replaces everything currently in the database. Practise this on a test copy before you ever need it.
set -euo pipefail
cd "$(dirname "$0")/.."
file=${1:?Usage: ./scripts/restore.sh backups/db-<date>.dump}
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
read -r -p "This REPLACES the current database with $file. Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "Cancelled."; exit 1; }
docker compose stop app
docker compose exec -T db psql -U school -d postgres -c "drop database school with (force)" -c "create database school owner school"
docker compose exec -T db pg_restore -U school -d school --no-owner < "$file"
docker compose start app
echo "Restored. Uploaded files are restored separately:  docker compose exec -T app tar -C /data -xzf - < backups/files-<date>.tar.gz"
