# HMQA JURNAL BOT implementation status

Allowed values: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `TESTED`, `VERIFIED`, `BLOCKED_EXTERNAL`.

`VERIFIED` requires automated or reproducible manual evidence. Academy approval and real staging/production checks cannot be inferred from local tests.

| Requirement | Status | Evidence / next gate |
|---|---|---|
| R-001 Telegram-only author journey | TESTED | grammY bot flow covers the exact welcome/selector, Help, Contact, Journals, Requirements, submission/drafts/articles/profile/language/cancel and durable Back/Home behavior without Mini App or privacy buttons; candidate real Telegram UAT pending |
| R-002 Three complete locales | TESTED | Three bundles, fallback/placeholder/key-parity tests; Academy linguistic approval pending |
| R-003 Persistent draft wizard | TESTED | PostgreSQL article/profile draft state, expiry, optimistic locking, resume/save/cancel/replace and existing-profile snapshots are covered by bot/unit and real PostgreSQL locale-preservation tests; real Telegram restart/resume UAT remains external |
| R-004 Versioned journal requirements | TESTED | Structured DRAFT edit/UZ-RU-EN preview, optimistic locking, return-to-draft, concurrent version serialization, four-eyes publication and active-version selection are implemented with local static/unit coverage; candidate real-DB/browser execution is pending CI |
| R-005 Immutable submission versions | VERIFIED | Real PostgreSQL/Redis E2E verified atomic idempotent initial submission, immutable revision v1/v2 rows and distinct object keys |
| R-006 Secure file pipeline | VERIFIED | Nine real MinIO/ClamAV/LibreOffice assertions verified signature/MIME/size/EICAR/AV failure/quarantine/promotion/version recovery/DOCX rendering, SHA-256 and SSE; runtime report retained by CI |
| R-007 Controlled workflow state machine | VERIFIED | Exhaustive unit tests enumerate every status, every allowed/forbidden edge, permissions, guards, and SUBMITTED/REGISTERED distinction |
| R-008 Atomic history/audit/outbox transition | VERIFIED | Real PostgreSQL integration exercised every allowed edge and verified status, history, hash-chained audit and notification outbox atomically; invalid edges left no partial writes |
| R-009 SUBMITTED/REGISTERED versus ACCEPTED | VERIFIED | Canonical status model, negative transition test, distinct localized wording |
| R-010 Administrator auth, 2FA, single-role authorization | TESTED | `AUTHOR`/`ADMIN` matrix, ADMIN-only sessions/catalog/invitations, step-up password/TOTP reset and mandatory re-enrollment are implemented; candidate real-DB, CI, deployment and browser verification pending |
| R-011 Product-aligned admin | TESTED | Exact eight-item navigation, current-route language switcher, Administrators/Settings security, prominent structured journal/requirements flow, standalone reviewers, Telegram contacts and hidden normal Audit/Privacy navigation pass local type/static tests; expanded browser regression is implemented but runtime/UAT execution is pending |
| R-012 Standalone reviewers/admin assignments/revisions | TESTED | Reviewer login dependency and staff-role selector are removed; standalone reviewer records and ADMIN article assignments are implemented with updated E2E/API tests; candidate real-DB execution pending |
| R-013 Notification/document outbox | VERIFIED | Real Redis suite verified duplicate suppression, exponential retry, terminal DLQ retention and graceful worker restart; E2E verified persisted notification outbox and localized document path |
| R-014 OpenAPI typed API | VERIFIED | Live Compose probe verified Swagger UI/JSON, typed public routes and cookie auth while internal service routes remained hidden; schema/DTO/error/pagination contracts also passed build/typecheck |
| R-015 Immutable audit | TESTED | Append-only API, hash chain, actor/request/network hashes and atomic audit creation passed unit/integration/E2E; final production database-role grants remain an operator deployment check |
| R-016 Security controls/log minimization | TESTED | Existing controls are verified; expanded password/TOTP/enrollment-token logger redaction and secret-free reset audit coverage pass locally; exact-SHA CI/CodeQL/runtime verification pending |
| R-017 Observability/health/alerts | VERIFIED | Live Compose verified API/bot/worker readiness, structured request IDs/logs and dependency-aware failure/recovery for PostgreSQL, Redis, S3 and ClamAV; metrics and alert rules passed repository gates |
| R-018 Backup/restore | VERIFIED | CI created encrypted PostgreSQL/object backups, verified manifests/checksums, restored into isolated DB/S3, proved row counts plus actual object SHA-256/size/SSE, and passed restored-API readiness/application smoke |
| R-019 One-command local deployment | VERIFIED | A clean Ubuntu 24 GitHub runner built and started the complete Compose graph through `pnpm verify:runtime`; all 62 runtime checks passed |
| R-020 CI gates | TESTED | Previous baseline run 34313143644 passed; exact-candidate CI and CodeQL are mandatory before deployment |
| R-021 Schema/migrations/constraints/indexes | TESTED | Eleven ordered migrations and generated Prisma client validate locally; clean and legacy-upgrade execution for the new product-model migration is pending CI/runtime |
| R-022 Safe idempotent seed | VERIFIED | CI executed the synthetic development seed twice against a clean database; the production refusal gate remains enforced |
| R-023 Reports/authorized exports | TESTED | Scoped overview and formula-safe non-PII audited CSV export passed build/RBAC surface verification; Academy report-format UAT remains external |
| R-024 Data-subject/retention/legal hold | TESTED | Real DB integration verified durable owner-scoped requests, masking, case transitions, legal holds and unapproved-retention guard; Academy policy approval remains external |
| R-025 Documentation/runbooks | TESTED | README, architecture, admin/security guides, traceability, decisions and ADR 0009 reflect the high-priority product override; final release self-review pending |
| AC-001 through AC-025 | IN_PROGRESS | Previous baseline evidence remains useful, but the candidate product-model migration requires fresh CI/runtime, real Admin Panel and real Telegram acceptance before release |
| Academy approvals, staging and production prerequisites | BLOCKED_EXTERNAL | Product owners, official policies/translations, BotFather/domain/TLS/secrets, staging and operations owners are external |

## Current candidate verification

The high-priority single-administrator product-model update is not yet a released or verified SHA. On 2026-09-10 the candidate passed local Prisma generation/validation, 25 files / 133 unit tests, all eight explicit i18n gates, formatting, lint, complete TypeScript typecheck, production build, Compose static validation, secret/public-history scans, and a moderate dependency audit. Real PostgreSQL/Redis integration, the legacy upgrade migration test, expanded browser suite, full Compose runtime, exact-SHA CI/CodeQL, deployment, authenticated-browser UAT, and real Telegram UAT remain required before any PASS claim.

## Previous baseline verification (not acceptance of the current candidate)

GitHub Actions main CI [run 34313143644](https://github.com/lilcipherx/hmqa-jurnal-bot/actions/runs/34313143644) verified baseline commit `f0e4b1dc6ae9c94f28ee355452aa9ab81a387d0b`. This evidence predates and does not verify the current product-model changes:

- quality passed: frozen install, Prisma validation, Compose validation, format, lint, typecheck, build, 18 files / 105 unit tests, 7 i18n assertions, public-history and secret scans, and a moderate dependency audit;
- integration passed against real PostgreSQL and Redis: 21/21 tests in 14 suites, with migrations applied from zero, schema-drift check and an idempotent twice-run seed;
- E2E passed: 3/3 tests in 4 suites covered author submission plus both acceptance/publication and rejection editorial branches;
- runtime passed in 336.88 seconds: 62/62 checks, including 9 real MinIO/ClamAV/LibreOffice assertions, the complete proxied stack, Telegram duplicate-update smoke, admin auth/RBAC/rendering, encrypted backup and isolated restore, actual DB/object SHA-256/size/SSE consistency, restored application smoke, dependency outage/recovery and graceful restarts;
- the `required` aggregator passed. Runtime, integration and E2E required commands enforce zero skips and fail closed when a dependency is absent;
- CodeQL passed for the same implementation line with zero open code-scanning alerts; secret-scanning and Dependabot security alert inventories were also zero.

The Windows workstation itself does not provide Docker/Compose, `psql`, or `redis-cli`; this is no longer used as a substitute for runtime evidence because the complete suite passed on a clean Ubuntu 24 hosted runner. Real Academy staging, Telegram/BotFather, policy/translation approval and operations UAT remain external release gates.
