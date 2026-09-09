# HMQA JURNAL BOT implementation status

Allowed values: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `TESTED`, `VERIFIED`, `BLOCKED_EXTERNAL`.

`VERIFIED` requires automated or reproducible manual evidence. Academy approval and real staging/production checks cannot be inferred from local tests.

| Requirement | Status | Evidence / next gate |
|---|---|---|
| R-001 Telegram-only author journey | TESTED | grammY bot flow, localized BotFather catalog and `/start`, `/help`, `/journals`, `/submit`, `/drafts`, `/status`, `/profile`, `/language`, `/cancel`, `/privacy`, status/file-version views, signed downloads, and conversation tests; real Telegram staging smoke pending |
| R-002 Three complete locales | TESTED | Three bundles, fallback/placeholder/key-parity tests; Academy linguistic approval pending |
| R-003 Persistent draft wizard | IMPLEMENTED | PostgreSQL article/profile draft state, expiry, optimistic locking, resume/save/cancel/replace, existing-profile snapshot; locale-preservation integration test exists, real restart integration pending |
| R-004 Versioned journal requirements | IMPLEMENTED | Schema, lifecycle API, three-locale admin, pinned submission reference, versioned reviewer/workflow policy; clean-DB runtime pending |
| R-005 Immutable submission versions | IMPLEMENTED | Atomic idempotent initial/revision creation, receipt snapshot, and E2E spec; real DB E2E not runnable on this host |
| R-006 Secure file pipeline | TESTED | Requirement-driven multi-file validation, declared/detected MIME, bounded OOXML and configurable LibreOffice preflight, private clean/evidence buckets, hash/signature/ClamAV, immutable author/reviewer versions, PF-015, signed URL/version recovery, and unit/runtime specs; real MinIO/ClamAV/LibreOffice run pending |
| R-007 Controlled workflow state machine | VERIFIED | Exhaustive unit tests enumerate every status, every allowed/forbidden edge, permissions, guards, and SUBMITTED/REGISTERED distinction |
| R-008 Atomic history/audit/outbox transition | IMPLEMENTED | Serializable repository plus exhaustive all-edge atomic integration assertions; PostgreSQL execution pending |
| R-009 SUBMITTED/REGISTERED versus ACCEPTED | VERIFIED | Canonical status model, negative transition test, distinct localized wording |
| R-010 Staff auth, 2FA, RBAC, scopes | TESTED | Argon2/TOTP/session/CSRF/scope implementation, exact role-permission unit matrix, exhaustive HTTP RBAC and lockout/session integration specs; live execution pending |
| R-011 Complete editorial admin | TESTED | Dashboard/submissions/files/messages/assignments/reviews/decisions/journals/users/translations/reports/audit/ops/privacy implemented, built and covered by a full-stack rendered-page probe; Academy browser UAT pending |
| R-012 Reviews/assignments/deadlines/revisions | IMPLEMENTED | Assignment/reviewer APIs and UI, future-deadline/duplicate guards, audited anonymized derivative upload/full scan, reviewer acceptance/conflict isolation, configurable review counts, immutable revisions, persisted deadlines, four-eyes decisions |
| R-013 Notification/document outbox | TESTED | BullMQ relay, backoff, lease recovery, provider receipts, template snapshots, DLQ/replay UI, localized PDF receipt generator, and real-Redis retry/duplicate/DLQ/restart suite; live execution pending |
| R-014 OpenAPI typed API | IMPLEMENTED | Swagger UI/JSON exposes every public route and cookie auth while internal service routes are hidden; strict typed Zod DTOs, uniform errors, pagination/filtering/sorting, and an OpenAPI runtime probe are present |
| R-015 Immutable audit | IMPLEMENTED | Scoped append-only API, hash chain, actor/request/network hashes; DB privilege test pending |
| R-016 Security controls/log minimization | TESTED | Headers, CSRF, validation, rate limiting, production placeholder rejection, query/PII-minimized logs, traversal/header-safe filenames, XSS-safe Telegram rendering, and local security tests |
| R-017 Observability/health/alerts | IMPLEMENTED | Structured logs, echoed request IDs, API/worker metrics, dependency-aware probes, Sentry, Prometheus/Alertmanager rules and fault-injection harness; live drill pending |
| R-018 Backup/restore | IMPLEMENTED | Encrypted restic DB+object backup, timestamp/size/checksum manifest, pre-restore checksum enforcement, separate recovery DB/S3 and application smoke harness; execution pending |
| R-019 One-command local deployment | IMPLEMENTED | Compose graph, automatic migration and isolated `pnpm verify:runtime` acceptance command supplied; Docker is physically unavailable on this host |
| R-020 CI gates | IMPLEMENTED | Required quality, PostgreSQL/Redis integration and full Compose runtime jobs; all enforce zero skips and feed the required aggregator; candidate-SHA hosted run pending |
| R-021 Schema/migrations/constraints/indexes | IMPLEMENTED | Prisma schema and nine ordered migrations; clean PostgreSQL application pending |
| R-022 Safe idempotent seed | IMPLEMENTED | Production refusal, synthetic identities/journals, CI twice-run gate; real CI run pending |
| R-023 Reports/authorized exports | IMPLEMENTED | Scoped overview and formula-safe non-PII audited CSV export |
| R-024 Data-subject/retention/legal hold | IMPLEMENTED | Author case API/bot, admin transition workflow, scoped permissions, audit/notifications, legal holds and retention execution guard; real DB integration and Academy policy approval pending |
| R-025 Documentation/runbooks | IMPLEMENTED | README, architecture, deployment, admin, security, backup/restore, ADRs, decisions, release checklist |
| AC-001 through AC-025 | IN_PROGRESS | Per-scenario evidence register in `tests/acceptance/README.md`; full DB/runtime/staging acceptance and UAT pending |
| Academy approvals, staging and production prerequisites | BLOCKED_EXTERNAL | Product owners, official policies/translations, BotFather/domain/TLS/secrets, staging and operations owners are external |

## Latest verification run

Local verification on 2026-09-09:

- `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`: passed after the latest security/runtime changes;
- `pnpm test`: 16 files / 96 tests passed;
- `pnpm test:i18n`: 1 file / 7 tests passed;
- integration discovery: 7 files / 20 tests, all skipped only in the non-required convenience run because runtime services are absent;
- E2E discovery: 2 files / 3 tests, all skipped for the same reason;
- required integration/E2E/runtime commands fail closed on missing services and CI runs them with real dependencies;
- the full build, format, Prisma, secret and dependency gates are repeated immediately before the baseline commit;
- Docker, Docker Compose, `psql`, and Redis CLI are absent. Node.js 24.18.0 and pnpm 11.19.0 are present. A standard `wsl --install --distribution Ubuntu-24.04 --no-launch` attempt failed with `0xc03a0014` (virtual-disk support provider unavailable), which requires host administration/component enablement and reboot;
- `pnpm verify:runtime` failed closed at its first preflight with `spawnSync docker ENOENT` and wrote a `FAILED` JSON evidence report; the three required suite commands likewise rejected missing runtime variables instead of skipping;
- therefore Compose execution, 20 integration tests, 3 E2E tests, 9 full-runtime assertions, backup/restore, live probes and fault injection are **not** claimed as passed on this host. Git is initialized on `main`; exact baseline SHA/state is reported from final Git evidence.
