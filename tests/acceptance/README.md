# Acceptance evidence register

This register maps every mandatory PRD acceptance scenario to current executable evidence and the remaining release gate. `VERIFIED` is used only when the scenario is fully proved by the named evidence; a unit test is not presented as a staging or operations acceptance result.

| ID | Scenario (condensed) | Status | Current evidence / remaining gate |
|---|---|---|---|
| AC-001 | New author completes start, consent, profile, and menu | TESTED | `apps/bot/src/bot.spec.ts`; real Telegram three-locale smoke pending |
| AC-002 | Author sees the active published requirement version | VERIFIED | Real clean-DB submission E2E used the journal's published current version and verified the immutable pinned foreign key |
| AC-003 | Draft survives every step and bot restart | TESTED | Real PostgreSQL locale-preservation test and persistent optimistic-lock model passed; real Telegram process restart/resume UAT remains external |
| AC-004 | Another Telegram/Public ID cannot read a submission | VERIFIED | Real E2E denied another Telegram identity the owner-bound file/submission surface with non-enumerating `404` |
| AC-005 | Missing required file blocks submission with a clear reason | TESTED | Workflow/file-policy unit coverage; end-to-end localized response pending |
| AC-006 | Spoofed MIME/signature, malware, and ZIP bomb are contained | VERIFIED | Unit/bounded OOXML coverage and nine real MinIO/ClamAV/LibreOffice assertions passed clean/EICAR/MIME/extension/size/AV/storage failure paths |
| AC-007 | Duplicate webhook/final click creates one submission/Public ID | VERIFIED | Live stack duplicate-update smoke plus real E2E repeated final submit produced exactly one submission and the same Public ID/receipt job |
| AC-008 | SUBMITTED and ACCEPTED differ in wording and authority | VERIFIED | Domain negative-transition and i18n parity tests |
| AC-009 | Return has reason, message, deadline, and notification | TESTED | Real editorial E2E persisted revision reason/deadline transition and one atomic notification per status; exact Academy message-content UAT remains external |
| AC-010 | Revision creates immutable version N+1 | VERIFIED | Real editorial E2E asserted separate v1/v2 version rows and object keys before completing acceptance/publication |
| AC-011 | Staff cannot access another journal | VERIFIED | Real HTTP/PostgreSQL RBAC matrix denied list/detail access across journal scope and denied unprivileged decisions |
| AC-012 | PII is masked and disclosure/download is audited | VERIFIED | Real privacy integration verified masked contacts/owner scope; E2E verified owner-only signed downloads and an actor/journal-scoped audit event |
| AC-013 | Final decision enforces step-up/four-eyes policy | VERIFIED | Domain permission, step-up, and four-eyes unit tests |
| AC-014 | Retry does not duplicate status events; DLQ/replay is controlled | VERIFIED | Real Redis suite passed durable duplicate ID, exponential retry, terminal DLQ retention and graceful worker restart; transition writes remained atomic |
| AC-015 | Published requirements are immutable and replaced by a new version | VERIFIED | Lifecycle guards, pinned hashes and real E2E requirement reference passed against clean PostgreSQL |
| AC-016 | Existing submission retains its requirement snapshot | VERIFIED | Real E2E proved the submission retained the exact published requirement ID and immutable receipt/version snapshot |
| AC-017 | External integration failure is retried/reconciled without data loss | VERIFIED | Runtime injected and recovered Redis, PostgreSQL, S3 and ClamAV outages, then rechecked service readiness and DB/object consistency |
| AC-018 | Encrypted backup restores with matching hashes/key records | VERIFIED | CI encrypted and restored DB/S3 into isolated targets, then proved row counts, actual object SHA-256/size/SSE and restored application smoke |
| AC-019 | Operations validates dashboards, alerts, and runbooks | TESTED | Live readiness/log/fault-injection verification passed; Academy operations dashboard/alert sign-off remains external |
| AC-020 | Each active journal passes signed staging UAT | NOT_STARTED | Academy product owners and staging environment required |
| AC-021 | First start offers all locales and persists the selection | TESTED | Bot locale catalog/conversation and i18n tests; real Telegram smoke pending |
| AC-022 | Safe-state language change preserves draft and snapshots | VERIFIED | Real PostgreSQL/Redis locale-preservation integration passed profile/draft/file/submission/wizard invariants across all three locales |
| AC-023 | Locale keys/placeholders match and fail the build on drift | VERIFIED | `packages/i18n/src/i18n.spec.ts` runs in required CI quality job |
| AC-024 | Status/errors/notifications/privacy/help/receipt do not mix locales | TESTED | Mandatory runtime-surface rendering, placeholder parity and raw-key tests cover all locales; real Telegram journey pending |
| AC-025 | Admin works in all locales while domain codes remain stable | TESTED | Three-locale SSR admin, stable enum codes and all-page full-stack probe; Academy browser UAT pending |

The release checklist remains authoritative for final staging, recovery, operational, and Academy sign-off evidence.
