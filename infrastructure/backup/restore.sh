#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${RESTORE_SNAPSHOT:?RESTORE_SNAPSHOT is required}"
if [[ "${CONFIRM_RESTORE:-}" != "HMQA_RESTORE" ]]; then echo "Set CONFIRM_RESTORE=HMQA_RESTORE" >&2; exit 64; fi
work_dir="$(mktemp -d /tmp/hmqa-restore.XXXXXX)"
trap 'rm -rf -- "$work_dir"' EXIT
restic restore "$RESTORE_SNAPSHOT" --target "$work_dir"
dump_path="$(find "$work_dir" -name postgres.dump -type f -print -quit)"
objects_path="$(find "$work_dir" -name objects -type d -print -quit)"
test -n "$dump_path" && test -n "$objects_path"
backup_root="$(dirname "$dump_path")"
test -f "$backup_root/postgres.dump.sha256"
(
  cd "$backup_root"
  sha256sum -c postgres.dump.sha256
  if [[ -s objects.sha256 ]]; then sha256sum -c objects.sha256; fi
)
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$PGDATABASE" "$dump_path"
mc alias set target "$SOURCE_S3_ENDPOINT" "$SOURCE_S3_ACCESS_KEY" "$SOURCE_S3_SECRET_KEY" >/dev/null
mc mirror --overwrite "$objects_path" "target/$SOURCE_S3_BUCKET"
printf 'HMQA_RESTORE_VERIFIED snapshot=%s manifest=%s\n' "$RESTORE_SNAPSHOT" "$backup_root/manifest.json"
if [[ -f "$backup_root/manifest.json" ]]; then cat "$backup_root/manifest.json"; fi
