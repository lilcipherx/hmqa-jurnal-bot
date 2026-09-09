# HMQA JURNAL BOT

Production-oriented monorepo for receiving and managing journal submissions through a normal Telegram bot. The author journey does **not** use a Telegram Mini App.

[![CI](https://github.com/lilcipherx/hmqa-jurnal-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/lilcipherx/hmqa-jurnal-bot/actions/workflows/ci.yml)
[![CodeQL](https://github.com/lilcipherx/hmqa-jurnal-bot/actions/workflows/codeql.yml/badge.svg)](https://github.com/lilcipherx/hmqa-jurnal-bot/actions/workflows/codeql.yml)

The Markdown PRD is the product source of truth. Architectural decisions, source differences, and Academy-owned open decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## What is included

- durable multilingual Telegram registration, consent, seven-field author profile, journal catalog and requirements, submission/revision wizard, immutable file list/downloads, notifications, useful Help, and configurable contacts;
- PostgreSQL-backed drafts and immutable submission/file/requirements versions;
- Fastify API with OpenAPI, opaque administrator sessions, Argon2id, mandatory TOTP, CSRF, rate limits, single-role backend authorization, request IDs, and audit hash chaining;
- private S3/MinIO file ingestion through isolated processing and evidence quarantine, DOCX/PDF signature/container validation, ClamAV, SHA-256, configurable rendered DOCX/PF-015 evidence, editorial anonymized derivatives, and short-lived owner/RBAC-authorized download URLs;
- BullMQ outbox delivery with exponential retry, leases, deterministic job IDs, notification delivery receipts, localized immutable PDF submission receipts, dead-letter state, and controlled replay;
- localized Next.js administration for articles, journals and requirement versions, standalone reviewers, Telegram content/contacts, notifications, administrator invitations, and security settings, with audit/privacy retained as backend controls;
- Docker Compose, migrations, synthetic seed data, Prometheus alerts, encrypted off-host backups, restore tooling, and CI gates.

Authors use the standard Telegram chat interface for registration, language selection, profile management, journal requirements, durable drafts, coauthors and metadata, uploads, preview, submission, status tracking, revisions, notifications, help, and contacts. Editorial staff use a separate localized web application with mandatory backend authorization and 2FA. All user surfaces support `uz-Latn`, `ru`, and `en` through the centralized i18n package.

## Repository map

```text
apps/              bot, API, worker, and staff web application
packages/          contracts, config, database, domain, i18n, logging, security, shared queues
infrastructure/    Docker, nginx, monitoring, and backup/restore
docs/              architecture, ADRs, operations, security, and traceability
tests/             cross-service acceptance tests
```

## Local start

Prerequisites: Docker Engine with Compose v2. The build image supplies Node.js 24 and pnpm 11; host Node is needed only when running checks outside containers.

1. Copy `.env.example` to `.env`.
2. Replace every `replace-with-...` value. Set a real BotFather token/username and generate independent secrets of at least 32 random characters. For local HTTP, keep `NODE_ENV=development`.
3. Start the stack:

   ```bash
   docker compose up -d --build
   ```

   The `migrate` one-shot service applies all migrations before API/worker startup. PostgreSQL, Redis, MinIO, and ClamAV are not published to the host.

4. Optionally load synthetic development records:

   ```bash
   docker compose exec api pnpm db:seed
   ```

   The seeded journals are deliberately closed and the Axborotnomasi requirements remain a non-published draft until Academy policy is approved. Seed credentials are forbidden in production.

5. Open `http://localhost:8080`. API documentation is at `http://localhost:8080/documentation`. Direct local health checks are available inside the network at `/health/live` and `/health/ready`.

For a public Telegram webhook, `BOT_BASE_URL` must be an HTTPS origin routed to `/telegram/webhook`. Staging/production startup registers that URL with the configured secret header.

## Environment inventory

`.env.example` is the complete variable inventory. Important groups are:

- public origins and Telegram: `APP_BASE_URL`, `ADMIN_BASE_URL`, `BOT_BASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `PUBLIC_BOT_USERNAME`;
- data and queues: `DATABASE_URL`, `REDIS_URL`;
- private storage: `S3_ENDPOINT`, clean/quarantine bucket names, access credentials, encryption and signed-URL lifetime;
- processing: ClamAV address, upload limits, quarantine directory, LibreOffice executable and timeouts;
- staff security: service/session/encryption secrets, local-auth policy and session lifetimes;
- operations: metrics token, OpenTelemetry/Sentry destinations, retention gates and encrypted restic backup configuration.

Staging and production fail fast on placeholder/short secrets, malformed Telegram tokens, non-HTTPS public origins, or a shared clean/quarantine bucket. Do not derive real configuration from `.env.test.example`; it is an explicitly synthetic acceptance fixture.

## Developer checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm db:generate
pnpm compose:validate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:i18n
pnpm security:secrets
pnpm security:public
pnpm audit --audit-level moderate
```

The convenience commands `pnpm test:integration` and `pnpm test:e2e` skip when their services are absent. Release and CI gates use `pnpm test:integration:required`, `pnpm test:e2e:required`, and `pnpm test:runtime:required`; these fail on a missing dependency, any skipped assertion, or zero executed tests.

To run the complete local acceptance drill with synthetic configuration:

```bash
pnpm verify:runtime
```

This command requires a working Docker Engine and Compose v2. It creates the isolated `hmqa-local-verification` Compose project, uses an ephemeral host port unless `HMQA_RUNTIME_HTTP_PORT` is explicitly set, builds all images, migrates a database from zero, runs the seed repeatedly, executes PostgreSQL/Redis/MinIO/ClamAV/LibreOffice tests, starts every application, exercises Telegram and admin paths, injects dependency outages, and performs an encrypted backup plus checksum-verified restore into separate recovery services. It removes only that project and its test volumes when finished. Set `KEEP_RUNTIME_STACK=true` only when inspecting a failed test stack. Machine-readable evidence is written to `.codex-temp/runtime-verification/report.json`.

`.env.test.example`, `docker-compose.test.yml`, and the Telegram API fixture are strictly marked `DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL`; they are not loaded by the default production Compose path. CI runs both the focused PostgreSQL/Redis suites and the full Compose runtime drill, so missing runtime services cannot result in a green required check.

## CI and public-source safety

CI runs on the registered UpCloud Ubuntu 24.04 X64 runner using `[self-hosted, Linux, X64]`. It uses no production secrets, grants only read access to repository contents in the main workflow, disables persisted checkout credentials, pins third-party actions to commit SHA, and never uses `pull_request_target`. Fork pull requests do not execute automatically on the persistent host. PostgreSQL/Redis integration and the full MinIO/ClamAV/LibreOffice Compose drill are mandatory for trusted candidate commits; required suites fail on skipped or zero tests.

`pnpm security:public` checks forbidden tracked paths, all reachable Git blobs, high-confidence secret formats, non-reserved email domains, and plausible phone numbers. This complements dependency audit, the working-tree secret scan, CodeQL, and human review; it does not make public issue content an approved channel for vulnerability reports.

## Operational documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Administrator guide](docs/ADMIN_GUIDE.md)
- [Security](docs/SECURITY.md)
- [API conventions](docs/API.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Requirements traceability](docs/REQUIREMENTS_TRACEABILITY.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)

## Release boundary

No release is production-approved until the Academy supplies the open product policies, production domains/secrets, approved translations/privacy copy, and a staging environment, and the release checklist records clean Compose, MinIO/ClamAV, backup/restore, Telegram, and UAT evidence. See `IMPLEMENTATION_STATUS.md`; absence of local Docker is not represented as a successful integration test.

## Contributing, security, and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). No software license has been approved by the owner, so this repository intentionally contains no `LICENSE` file. Public visibility does not grant reuse rights beyond those provided by applicable law.
