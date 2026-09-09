# Backup and restore

## Backup contract

The backup job creates a PostgreSQL custom-format dump and an S3 object mirror, then stores both in an encrypted off-host restic repository. Runtime and backup object-store credentials must be different. Retention defaults to 14 daily, 8 weekly, and 12 monthly snapshots and ends with `restic check`.

Every recovery set contains `manifest.json`, `postgres.dump.sha256`, and `objects.sha256`. The manifest records UTC timestamp, PostgreSQL dump size, dump checksum, object count, and source bucket. Restore refuses to run without the database checksum and verifies both checksum lists before changing the isolated target.

Database dumps alone are insufficient: submission metadata references immutable S3 object keys. PostgreSQL and clean object content must be captured and restored as one recovery set. Quarantine evidence has a separate bucket and retention/access policy; include it in an isolated encrypted backup target only after the Academy approves malware-evidence and legal-hold periods.

## Run a backup

Configure `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, backup S3 credentials, and source DB/S3 variables. Then run:

```bash
docker compose --profile backup run --rm backup
```

The backup container always mounts `RESTIC_LOCAL_REPOSITORY_PATH` at `/var/lib/hmqa/restic`; it defaults to the persistent Compose volume `backup-repository`. This prevents a local staging fallback such as `RESTIC_REPOSITORY=/var/lib/hmqa/restic` from being written into the disposable `docker compose run --rm` container. To retain a temporary host-visible staging copy, set `RESTIC_LOCAL_REPOSITORY_PATH` to a pre-created, owner-restricted absolute host directory. This fallback does not satisfy the production off-host requirement.

The command must return zero after `restic check`; its final output includes the manifest and latest tagged snapshot. Record snapshot ID, timestamp, database size/checksum, object count, restic check result, and alert status. Schedule the same container with the platform scheduler; do not keep the only schedule inside the application process.

For a destructive-but-isolated local drill, use `pnpm verify:runtime`. Its test override recreates the source database from zero, seeds it, writes a checksum-addressed evidence object with matching `FileAsset` metadata, stores encrypted restic data in a project-scoped volume, restores into separate `postgres-recovery` and `minio-recovery` volumes, compares critical row counts, verifies DB-to-object size/SHA/SSE consistency, starts `api-recovery`, and checks the restored journal catalog. This is acceptance evidence for the mechanism, not evidence for an Academy off-host repository or production RPO/RTO.

## Isolated restore test

Never test a restore over production.

1. Provision an empty isolated PostgreSQL database and empty private bucket.
2. Stop test bot/worker consumers.
3. Select a snapshot with `restic snapshots`.
4. Override all `PG*` and source S3 variables to the isolated targets.
5. Execute the restore image with `RESTORE_SNAPSHOT=<id>`, `CONFIRM_RESTORE=HMQA_RESTORE`, and entrypoint `/usr/local/bin/hmqa-restore`.
6. Confirm checksum verification completed, run migrations in status-only mode, compare row counts, sample stored SHA-256 values, and confirm every sampled object key exists.
7. Start an application candidate against the restored targets and run readiness plus submission/file-download smoke tests.
8. Delete the isolated environment according to the approved evidence-retention policy and record achieved RPO/RTO.

Example:

```bash
docker compose --profile backup run --rm \
  --entrypoint /usr/local/bin/hmqa-restore \
  -e RESTORE_SNAPSHOT=latest \
  -e CONFIRM_RESTORE=HMQA_RESTORE \
  backup
```

The restore script uses `pg_restore --clean --if-exists` and `mc mirror --overwrite`; the confirmation value and isolated target verification are mandatory because this is destructive.

## Object version recovery

The clean bucket is private and versioning is enabled by `minio-init`. Application object keys include the file-asset ID and SHA-256 and are never reused for manuscript revisions. For accidental deletion, identify the exact key from the database/audit log, list versions with an authorized storage account, recover the last known SHA-256-matching version, and record the recovery event. The full runtime suite creates v1/v2 object versions, applies a delete marker, and proves retrieval of the selected prior version. Database-to-object consistency remains part of every restore drill; never silently repoint a `FileAsset` to content with a different checksum.

## Production recovery order

Pause ingress and all workers, preserve logs/queues, restore PostgreSQL and objects, verify integrity, run compatible migrations, start API/worker, then bot/admin, and finally reopen ingress. Treat Telegram provider messages as at-least-once across a disaster boundary and reconcile notification receipts before replay.
