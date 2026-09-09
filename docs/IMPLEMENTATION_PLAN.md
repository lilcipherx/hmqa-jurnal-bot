# HMQA JURNAL BOT vertical implementation plan

Each slice must deliver schema, API/domain behavior, UI/bot behavior, localized text, audit/metrics, tests, and documentation together.

1. Foundation: workspace, validated configuration, logging, database, Redis, object storage, Docker, CI, health and documentation.
2. Identity and localization: Telegram identity, privacy consent, staff local auth/TOTP/session, permission matrix, locale selection and parity gates.
3. Journal catalog and configuration: journal records, localized immutable requirement versions, publish validation, open/closed/native/external modes.
4. Persistent author drafts: profile snapshots, coauthors, metadata, declarations, durable wizard state, optimistic concurrency, resume/cancel/delete.
5. File pipeline: quarantine, validation, checksum, ClamAV, private S3, immutable version links, isolated OOXML preflight and cleanup.
6. Submission transaction: completeness guards, idempotent final confirmation, public ID, immutable version, receipt, own-article views.
7. Editorial workflow: queue, detail, assignment/claim, structured correction, reviewer packages, revisions, four-eyes decisions, publish/withdraw/archive.
8. Notifications and conversations: template snapshots, locale, retries/backoff, delivery status, DLQ/replay, official author-editor threads.
9. Complete admin surfaces: journals, requirements, translations, users/roles/scopes, reports, audit, settings and operations.
10. Hardening and acceptance: security/resilience/performance suites, monitoring/alerts, backup/restore drill, all-locale E2E, UAT package and release checklist.

Production rollout is not a partial-slice deliverable. It requires every mandatory row in `IMPLEMENTATION_STATUS.md` to be VERIFIED plus the external Academy approvals listed in `docs/DECISIONS.md`.
