#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${SOURCE_S3_ENDPOINT:?SOURCE_S3_ENDPOINT is required}"
: "${SOURCE_S3_ACCESS_KEY:?SOURCE_S3_ACCESS_KEY is required}"
: "${SOURCE_S3_SECRET_KEY:?SOURCE_S3_SECRET_KEY is required}"
: "${SOURCE_S3_BUCKET:?SOURCE_S3_BUCKET is required}"
work_dir="$(mktemp -d /tmp/hmqa-backup.XXXXXX)"
trap 'rm -rf -- "$work_dir"' EXIT
if ! restic snapshots >/dev/null 2>&1; then restic init; fi
pg_dump --format=custom --no-owner --no-acl --file="$work_dir/postgres.dump"
mc alias set source "$SOURCE_S3_ENDPOINT" "$SOURCE_S3_ACCESS_KEY" "$SOURCE_S3_SECRET_KEY" >/dev/null
mkdir -p "$work_dir/objects"
mc mirror --preserve "source/$SOURCE_S3_BUCKET" "$work_dir/objects"
(
  cd "$work_dir"
  sha256sum postgres.dump > postgres.dump.sha256
  : > objects.sha256
  while IFS= read -r -d '' object; do
    sha256sum "$object" >> objects.sha256
  done < <(find objects -type f -print0 | sort -z)
)
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dump_size="$(wc -c < "$work_dir/postgres.dump" | tr -d ' ')"
dump_sha256="$(cut -d ' ' -f1 "$work_dir/postgres.dump.sha256")"
object_count="$(find "$work_dir/objects" -type f | wc -l | tr -d ' ')"
printf '{"schemaVersion":1,"createdAt":"%s","postgresDumpBytes":%s,"postgresDumpSha256":"%s","objectCount":%s,"sourceBucket":"%s"}\n' \
  "$created_at" "$dump_size" "$dump_sha256" "$object_count" "$SOURCE_S3_BUCKET" \
  > "$work_dir/manifest.json"
restic backup \
  "$work_dir/postgres.dump" \
  "$work_dir/postgres.dump.sha256" \
  "$work_dir/objects" \
  "$work_dir/objects.sha256" \
  "$work_dir/manifest.json" \
  --tag hmqa
restic forget \
  --tag hmqa \
  --group-by tags \
  --keep-daily "${RESTIC_KEEP_DAILY:-14}" \
  --keep-weekly "${RESTIC_KEEP_WEEKLY:-8}" \
  --keep-monthly "${RESTIC_KEEP_MONTHLY:-12}" \
  --prune
restic check
printf 'HMQA_BACKUP_EVIDENCE=%s\n' "$work_dir/manifest.json"
cat "$work_dir/manifest.json"
restic snapshots --latest 1 --tag hmqa
