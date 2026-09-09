# HMQA JURNAL BOT requirements traceability matrix

Status values are tracked in `IMPLEMENTATION_STATUS.md`. Evidence links are updated only after reproducible verification.

| Requirement | Source | Implementation surface | Verification |
|---|---|---|---|
| R-001 Telegram-only author journey; no Mini App | PRD 2.2, 4, 5, 24.1; request | `apps/bot`, API author endpoints | Bot conversation and repository policy tests |
| R-002 Three complete locales | PRD 23, Appendix A; request | `packages/i18n`, bot, API, admin, notifications | Key/placeholder parity, snapshots, E2E per locale |
| R-003 Persistent recoverable draft wizard | PRD 5, 7.2, 13.5 | PostgreSQL draft/session models, bot actions | Optimistic-lock/revision E2E and locale-preservation integration tests; runtime restart drill |
| R-004 Versioned journal configuration and requirements | PRD 6, 11, 14 | Database schema, configuration API/admin | Immutable-version and publish-gate tests |
| R-005 Immutable submission/version snapshot | PRD 5.7, 7.4, BR-003/004 | Submission transaction and schema | Transaction/idempotency/version tests |
| R-006 Secure file pipeline | PRD 15; request | File worker, S3, ClamAV, validation policy | MIME/signature/size/hash/malware/OOXML unit tests plus real S3/ClamAV/LibreOffice runtime suite |
| R-007 Controlled submission state machine | PRD 8; request | `packages/domain`, workflow service | Transition table, guard, concurrency tests |
| R-008 Atomic transition, history, audit, outbox | PRD 8, 9, BR-005/006 | Prisma transaction, worker | Every whitelist edge asserted atomically in PostgreSQL integration; failure injection harness |
| R-009 SUBMITTED/REGISTERED never means ACCEPTED | PRD terminology, 5, 8, AC-008 | Status model, i18n, notifications | Negative wording/permission tests |
| R-010 Staff authentication, 2FA, RBAC, journal scopes | PRD 3, 10, 16 | API auth/security, admin | Exact unit matrix, HTTP role/resource matrix, TOTP/lockout/session/CSRF/IDOR tests and admin runtime probe |
| R-011 Complete editorial admin | PRD 10-11; request | `apps/admin-web`, admin API | Component/API/E2E employee journeys |
| R-012 Reviews, assignments, deadlines, revisions | PRD 7.4, 8, 10 | Database, workflow/API/admin | Assignment/reviewer/revision tests |
| R-013 Reliable localized notification outbox | PRD 9 | Database, BullMQ worker, i18n | Real Redis consumption/retry/backoff/idempotency/DLQ/restart tests |
| R-014 Documented typed API | PRD 14 | Fastify JSON schemas/OpenAPI/contracts | OpenAPI and contract tests |
| R-015 Structured audit with immutable history | PRD 16.5; request | Database and audit service | Append-only/authorization tests |
| R-016 Security controls and minimized logs | PRD 16; request | Security/config/logger/proxy | SAST, secret scan, headers, rate-limit tests |
| R-017 Observability and health | PRD 18; request | API/bot/worker metrics and monitoring | Runtime metric/request-ID/log checks and dependency fault injection |
| R-018 Backup/restore with integrity proof | PRD 18.5; request | `infrastructure/backup`, runbook | Manifest/checksum scripts and isolated DB/S3/API recovery drill in `pnpm verify:runtime` |
| R-019 One-command local environment | PRD 17, 24.4; request | Compose, Dockerfiles, env validation | `pnpm verify:runtime` clean-host Compose acceptance report |
| R-020 CI quality/security/migration gates | PRD 17.3; request | GitHub Actions | Fail-closed quality/integration/runtime aggregator on candidate SHA |
| R-021 Production schema, migrations, constraints, indexes | PRD 14; request | `packages/database` | Clean DB migration and constraint tests |
| R-022 Safe idempotent dev/test seed | PRD 24.6; request | Database seed | Repeat-run integration test |
| R-023 Reports and authorized exports | PRD 10, 14, 20 | API/admin/report worker | Permission, masking, audit, expiry tests |
| R-024 Data-subject requests, retention, legal hold | PRD 7.1, 16 | API/admin/scheduler | Case workflow and retention tests |
| R-025 Operations documentation and runbooks | PRD 18, 20 | `docs` | Release checklist review |

## PRD acceptance scenarios

All PRD scenarios `AC-001` through `AC-025` remain mandatory. Their current evidence and unresolved release gates are recorded in `tests/acceptance/README.md`; executable tests live beside the owning package or in `tests/submission.e2e.spec.ts`. A scenario cannot be marked `VERIFIED` from a catalog entry or implementation alone.
