# Deployment

## Production prerequisites

- x86-64 host or orchestrator with Docker-compatible container execution;
- managed or dedicated PostgreSQL 17 with encrypted volumes and restricted network access;
- Redis 8 with persistence and `noeviction` for BullMQ;
- separate private versioned S3-compatible clean and quarantine buckets with server-side encryption and backup credentials separated from runtime credentials;
- current ClamAV definitions, HTTPS ingress, DNS, certificate automation, secret manager, Sentry DSN, and an alert receiver;
- BotFather ownership and a public `BOT_BASE_URL` whose `/telegram/webhook` path reaches the bot service.
- a pinned LibreOffice Writer no-GUI package and approved fonts in the file-worker image for deterministic DOCX page rendering.

## Clean Ubuntu 24.04 server preparation

The following bootstrap uses Docker's official apt repository and a checksum-verified Node.js archive. Replace `<candidate-sha>` with the exact CI-green commit and review every environment value before execution.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git xz-utils
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Start a new login session after the group change, then verify Docker and install the repository's pinned Node/pnpm toolchain:

```bash
docker version
docker compose version
node_version=24.11.1
curl -fsSLO "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt"
grep " node-v${node_version}-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum --check --strict
sudo tar -xJf "node-v${node_version}-linux-x64.tar.xz" -C /usr/local --strip-components=1
rm "node-v${node_version}-linux-x64.tar.xz" SHASUMS256.txt
sudo corepack enable
corepack prepare pnpm@11.19.0 --activate
node --version
pnpm --version
```

Clone and detach verification from a moving branch:

```bash
git clone https://github.com/lilcipherx/hmqa-jurnal-bot.git
cd hmqa-jurnal-bot
git fetch --tags --prune
git checkout --detach <candidate-sha>
test "$(git rev-parse HEAD)" = "<candidate-sha>"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm compose:validate
pnpm security:public
```

Create `.env` from the inventory, replace every placeholder, restrict it to the deployment user, and validate Compose before starting anything:

```bash
cp .env.example .env
chmod 600 .env
${EDITOR:-vi} .env
docker compose --env-file .env config --quiet
```

Set `DEPLOYED_SHA` to the exact 40-character CI-green checkout. Staging and production refuse the ambiguous `development` value. The API, bot, worker, and admin liveness responses expose this non-secret identifier so operators can prove that the checkout and every running application use the same release.

Run the isolated acceptance drill before staging. It uses `.env.test.example`, never the production `.env`, and cleans only its run-specific project:

```bash
HMQA_RUNTIME_PROJECT="hmqa-verification-$(git rev-parse --short HEAD)" pnpm verify:runtime
node -e "const report=require('./.codex-temp/runtime-verification/report.json'); if(report.outcome!=='PASSED') process.exit(1)"
```

Then start staging with operator-approved configuration, apply forward migrations through the one-shot service, and inspect readiness:

```bash
docker compose --env-file .env up -d --build postgres redis minio minio-init clamav
docker compose --env-file .env run --rm migrate
docker compose --env-file .env up -d api bot worker admin-web nginx
docker compose --env-file .env --profile monitoring up -d
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=200 migrate api bot worker admin-web nginx
```

Do not run the development seed in staging unless the environment is explicitly disposable and Academy-approved synthetic fixtures are required. A real staging smoke/UAT and verified backup must still be recorded before promotion.

Do not expose PostgreSQL, Redis, MinIO, ClamAV, worker, or internal API addresses publicly. The bundled Compose file publishes only nginx.

## Configuration and secrets

Use `.env.example` as the inventory, not as production values. Generate independent values for session signing, envelope encryption, service authentication, webhook verification, S3, MinIO KMS, metrics, and backup encryption. `MINIO_KMS_SECRET_KEY` must use `<key-name>:<base64-encoded-random-32-byte-key>`; back it up separately because losing it makes encrypted MinIO data unrecoverable. Store the environment file with owner-only permissions or inject secrets from the platform secret manager. For managed S3, replace the bundled MinIO topology with the provider's private, versioned, KMS-backed bucket configuration and keep the application's SSE requirement enabled.

Production/staging refuses short or placeholder secrets and refuses non-HTTPS public URLs. Local staff authentication is disabled in production unless `LOCAL_AUTH_PRODUCTION_ENABLED=true` is an explicit approved policy. When local authentication is selected, every account must complete the invitation flow and TOTP enrollment.

## Deploy procedure

1. Pin the candidate image digest and record the Git SHA.
2. Validate configuration in a non-production shell and confirm DB/S3/Redis/ClamAV connectivity.
3. Take a verified pre-deploy backup.
4. Run the migration one-shot job. It must finish successfully before application rollout.
5. Roll out API, worker, bot, and admin, then nginx. Keep at least one previous application image available.
6. Verify live/readiness endpoints, Prometheus targets, queue depth, ClamAV readiness, private-bucket policy, and Sentry ingestion.
7. Run the smoke path: bot language/consent and slash commands, open test journal, draft persistence, required DOCX/PDF set and rendered preflight, registration, author-owned signed download, staff anonymized-package scan/assignment, public message, revision request, and notification delivery receipt.
8. Record the exact evidence in the release checklist.

For the bundled single-host topology:

```bash
docker compose up -d --build
docker compose --profile monitoring up -d
docker compose ps
```

Before staging promotion, run the same candidate with the repository's fail-closed local drill:

```bash
pnpm verify:runtime
```

It uses only the fixed project name `hmqa-local-verification` by default and removes only its isolated volumes. CI supplies a run-specific validated project name. The drill includes clean migration, repeat seed, all non-skipping test suites, real MinIO/ClamAV/LibreOffice processing, private/signed/versioned object checks, all service readiness probes, Telegram/admin probes, backup/restore, and Redis/PostgreSQL/MinIO/ClamAV/API/worker restart tests. Preserve the generated JSON report as candidate evidence.

Terminate TLS in a platform load balancer or a reviewed TLS-enabled nginx layer. The sample nginx listens on port 8080 and is not itself a certificate manager.

## Migration policy

Migrations are forward-only in production. Use expand/contract for destructive changes: add nullable/backfilled fields, deploy compatible code, verify, then remove old fields in a later release. Never run `prisma migrate dev` against staging or production.

## Rollback

- If no incompatible migration was applied, route traffic to the prior immutable image digest.
- If schema compatibility changed, keep the database and apply a reviewed forward fix. Do not restore a whole database merely to roll back application code.
- Pause bot ingress and workers before a data restore. Preserve failed queues and audit evidence.
- After rollback, repeat readiness and submission smoke checks and record the incident/candidate SHA.

## Scaling

API, bot, admin, and workers are stateless with respect to critical state and may be replicated. PostgreSQL remains authoritative. BullMQ locks prevent concurrent execution; database optimistic versions and unique identifiers remain the final concurrency guard. Scale file workers only after measuring ClamAV, network, and S3 capacity.

The API and file worker must mount the same quarantine volume in the single-host topology. In an orchestrator, replace it with a reviewed encrypted ephemeral/shared quarantine mechanism. Keep the worker filesystem read-only, drop Linux capabilities, preserve `no-new-privileges`, and size tmpfs/CPU/RAM for the approved render concurrency.
