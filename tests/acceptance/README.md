# Acceptance evidence register

This register maps every mandatory PRD acceptance scenario to current executable evidence and the remaining release gate. `VERIFIED` is used only when the scenario is fully proved by the named evidence; a unit test is not presented as a staging or operations acceptance result.

| ID | Scenario (condensed) | Status | Current evidence / remaining gate |
|---|---|---|---|
| AC-001 | New author completes start, consent, profile, and menu | TESTED | `apps/bot/src/bot.spec.ts`; real Telegram three-locale smoke pending |
| AC-002 | Author sees the active published requirement version | IMPLEMENTED | Pinned requirement APIs and bot view; clean-DB E2E pending |
| AC-003 | Draft survives every step and bot restart | IMPLEMENTED | PostgreSQL draft state/optimistic locking and locale-preservation integration spec; real restart drill pending |
| AC-004 | Another Telegram/Public ID cannot read a submission | IMPLEMENTED | Negative owner check in `tests/submission.e2e.spec.ts`; real DB run pending |
| AC-005 | Missing required file blocks submission with a clear reason | TESTED | Workflow/file-policy unit coverage; end-to-end localized response pending |
| AC-006 | Spoofed MIME/signature, malware, and ZIP bomb are contained | TESTED | Worker validation/bounded OOXML plus real clean/EICAR/MIME/extension/size/AV/storage failure runtime spec; execution pending |
| AC-007 | Duplicate webhook/final click creates one submission/Public ID | IMPLEMENTED | Idempotent submit assertion in `tests/submission.e2e.spec.ts`; real DB run pending |
| AC-008 | SUBMITTED and ACCEPTED differ in wording and authority | VERIFIED | Domain negative-transition and i18n parity tests |
| AC-009 | Return has reason, message, deadline, and notification | IMPLEMENTED | Transition guard plus atomic outbox path; DB/queue E2E pending |
| AC-010 | Revision creates immutable version N+1 | IMPLEMENTED | Full editorial lifecycle E2E asserts separate v1/v2 object keys and version rows; DB execution pending |
| AC-011 | Staff cannot access another journal | TESTED | Exhaustive `apps/api/src/rbac-matrix.integration.spec.ts`; real DB run pending |
| AC-012 | PII is masked and disclosure/download is audited | IMPLEMENTED | Scoped projections and audited signed downloads; real DB run pending |
| AC-013 | Final decision enforces step-up/four-eyes policy | VERIFIED | Domain permission, step-up, and four-eyes unit tests |
| AC-014 | Retry does not duplicate status events; DLQ/replay is controlled | IMPLEMENTED | Durable event IDs/claims/replay plus real Redis duplicate/retry/DLQ/restart suite; execution pending |
| AC-015 | Published requirements are immutable and replaced by a new version | IMPLEMENTED | Lifecycle API and pinned hashes; DB integration pending |
| AC-016 | Existing submission retains its requirement snapshot | IMPLEMENTED | Foreign-key pinning and immutable submit transaction; DB E2E pending |
| AC-017 | External integration failure is retried/reconciled without data loss | IMPLEMENTED | Transactional outbox/reconciliation and Redis/S3/ClamAV outage/recovery harness; execution pending |
| AC-018 | Encrypted backup restores with matching hashes/key records | IMPLEMENTED | Restic manifest/checksums and separate DB/S3/API recovery drill are automated; local execution is blocked by unavailable Docker |
| AC-019 | Operations validates dashboards, alerts, and runbooks | IMPLEMENTED | Metrics/readiness/fault-injection verification is automated; Academy operations sign-off remains external |
| AC-020 | Each active journal passes signed staging UAT | NOT_STARTED | Academy product owners and staging environment required |
| AC-021 | First start offers all locales and persists the selection | TESTED | Bot locale catalog/conversation and i18n tests; real Telegram smoke pending |
| AC-022 | Safe-state language change preserves draft and snapshots | IMPLEMENTED | Locale-preservation integration asserts profile/draft/file/submission/wizard invariants across all three locales; execution pending |
| AC-023 | Locale keys/placeholders match and fail the build on drift | VERIFIED | `packages/i18n/src/i18n.spec.ts` runs in required CI quality job |
| AC-024 | Status/errors/notifications/privacy/help/receipt do not mix locales | TESTED | Mandatory runtime-surface rendering, placeholder parity and raw-key tests cover all locales; real Telegram journey pending |
| AC-025 | Admin works in all locales while domain codes remain stable | TESTED | Three-locale SSR admin, stable enum codes and all-page full-stack probe; Academy browser UAT pending |

The release checklist remains authoritative for final staging, recovery, operational, and Academy sign-off evidence.
