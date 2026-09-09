# HMQA JURNAL BOT requirements traceability matrix

Status values follow `IMPLEMENTATION_STATUS.md`. `VERIFIED` means the named automated or reproducible evidence passed; it does not imply Academy staging or policy approval.

| Requirement | Source | Implementation surface | Verification evidence | Status |
|---|---|---|---|---|
| R-001 Telegram-only author journey; no Mini App | PRD 2.2, 4, 5, 24.1; request | `apps/bot`, API author endpoints | Conversation tests plus live Compose webhook/duplicate-update smoke; real BotFather/Telegram journey pending | TESTED |
| R-002 Three complete locales | PRD 23, Appendix A; request | `packages/i18n`, bot, API, admin, notifications | Seven key/placeholder/runtime-surface assertions and three-locale rendered admin probe; Academy linguistic approval pending | TESTED |
| R-003 Persistent recoverable draft wizard | PRD 5, 7.2, 13.5 | PostgreSQL draft/session models, bot actions | Real PostgreSQL locale-preservation test plus optimistic-lock and conversation coverage; real Telegram restart/resume UAT pending | TESTED |
| R-004 Versioned journal configuration and requirements | PRD 6, 11, 14 | Database schema, structured configuration API/admin | Structured DRAFT edit/preview, optimistic locking, return-to-draft, concurrent version serialization, four-eyes publication and active-version pinning are implemented; candidate real-DB/Playwright execution is pending CI | TESTED |
| R-005 Immutable submission/version snapshot | PRD 5.7, 7.4, BR-003/004 | Submission transaction and schema | Real E2E verified idempotent initial submit and immutable v1/v2 rows/object keys | VERIFIED |
| R-006 Secure file pipeline | PRD 15; request | File worker, S3, ClamAV, validation policy | Nine real MinIO/ClamAV/LibreOffice assertions plus unit signature/MIME/OOXML tests; SHA-256 and SSE checked | VERIFIED |
| R-007 Controlled submission state machine | PRD 8; request | `packages/domain`, workflow service | Exhaustive allowed/forbidden transition, permission, guard and four-eyes unit matrix | VERIFIED |
| R-008 Atomic transition, history, audit, outbox | PRD 8, 9, BR-005/006 | Prisma serializable transaction, worker | Real PostgreSQL test asserted every whitelist edge and invalid no-partial-write behavior | VERIFIED |
| R-009 SUBMITTED/REGISTERED never means ACCEPTED | PRD terminology, 5, 8, AC-008 | Status model, i18n, notifications | Negative transition, authority and distinct wording tests in all locales | VERIFIED |
| R-010 Administrator authentication, 2FA, and single-role authorization | PRD 3, 10, 16; owner high-priority override 2026-09-09 | API auth/security, admin | `AUTHOR`/`ADMIN` matrix, ADMIN-only sessions/catalog/invitations, step-up reset/password APIs, mandatory re-enrollment, session revocation, audit integration and regression tests implemented; exact-candidate runtime/deployed browser verification pending | TESTED |
| R-011 Complete editorial admin | PRD 10-11; owner high-priority override | `apps/admin-web`, admin API | Exact eight-item navigation and no deprecated role/scope controls pass static regression tests; candidate authenticated browser UAT is pending | TESTED |
| R-012 Standalone reviewers, assignments, deadlines, revisions | PRD 7.4, 8, 10; owner high-priority override | Database, workflow/API/admin | Standalone reviewer and ADMIN assignment paths are implemented; candidate real-DB editorial E2E is pending | TESTED |
| R-013 Reliable localized notification outbox | PRD 9 | Database, BullMQ worker, i18n | Real Redis duplicate/retry/backoff/DLQ/restart suite plus persisted E2E outbox | VERIFIED |
| R-014 Documented typed API | PRD 14 | Fastify JSON schemas/OpenAPI/contracts | Live OpenAPI probe, build/typecheck and contract tests | VERIFIED |
| R-015 Structured audit with immutable history | PRD 16.5; request | Database and audit service | Hash-chain/append-only/authorization behavior passed unit/integration/E2E; production grants remain deployment evidence | TESTED |
| R-016 Security controls and minimized logs | PRD 16; request | Security/config/logger/proxy | Existing gates plus new password/TOTP/enrollment-token redaction and secret-free audit tests; exact-SHA CI/CodeQL rerun pending | TESTED |
| R-017 Observability and health | PRD 18; request | API/bot/worker metrics and monitoring | Live readiness/log/request-ID checks and PostgreSQL/Redis/S3/ClamAV outage/recovery drill | VERIFIED |
| R-018 Backup/restore with integrity proof | PRD 18.5; request | `infrastructure/backup`, runbook | Encrypted backup plus isolated DB/S3 restore proved rows, actual object SHA-256/size/SSE and restored API smoke | VERIFIED |
| R-019 One-command local environment | PRD 17, 24.4; request | Compose, Dockerfiles, env validation | Clean Ubuntu 24 runner completed all 62 `pnpm verify:runtime` checks | VERIFIED |
| R-020 CI quality/security/migration gates | PRD 17.3; request | GitHub Actions | Baseline main CI run 34313143644 passed; a new exact-candidate CI and CodeQL run is required after the product-model migration | TESTED |
| R-021 Production schema, migrations, constraints, indexes | PRD 14; request | `packages/database` | Eleven ordered migrations are present and Prisma validates locally; clean and upgrade database execution is pending candidate CI/runtime | TESTED |
| R-022 Safe idempotent dev/test seed | PRD 24.6; request | Database seed | Clean CI database seed passed twice; production refusal is tested | VERIFIED |
| R-023 Reports and authorized exports | PRD 10, 14, 20 | API/admin/report worker | Scoped, formula-safe, non-PII audited CSV path passed static/RBAC surfaces; Academy format UAT pending | TESTED |
| R-024 Data-subject requests, retention, legal hold | PRD 7.1, 16 | API/admin/scheduler | Real DB test verified owner scoping, masking, transitions, holds and unapproved-retention guard; policy approval pending | TESTED |
| R-025 Operations documentation and runbooks | PRD 18, 20; owner override | root public docs and `docs` | ADR 0009 and operator/product guides describe the new single-admin model; final exact-candidate self-review pending | TESTED |

## PRD acceptance scenarios

All PRD scenarios `AC-001` through `AC-025` remain mandatory. Their current evidence and unresolved release gates are recorded in `tests/acceptance/README.md`; executable tests live beside the owning package or under `tests`. Automated database/runtime acceptance is complete where marked, but Academy staging/UAT is a separate external gate and is not inferred from CI.
