# Release checklist

Record date, candidate Git SHA/image digests, operator, environment, and links to immutable evidence. A blank item is not a pass. Checked automated items below were proved by GitHub Actions [run 34313143644](https://github.com/lilcipherx/hmqa-jurnal-bot/actions/runs/34313143644) for implementation SHA `f0e4b1dc6ae9c94f28ee355452aa9ab81a387d0b`; release still requires the unchecked external items.

## Quality

- [x] `pnpm verify:runtime` passed and its JSON evidence was retained;
- [x] clean `pnpm install --frozen-lockfile`, format, lint, typecheck, unit, integration, E2E, and build passed;
- [x] moderate-or-higher dependency audit, secret scan, SHA-pinned action review, and CodeQL passed;
- [x] public audit covered tracked paths, every reachable Git blob, PII heuristics, forbidden archives/keys, and confirmed no unreviewed `LICENSE` grant;
- [x] clean-database migrations, migration-status/schema-drift checks and twice-run seed passed;
- [x] requirement-to-evidence matrix and final diff were reviewed for mandatory placeholder/TODO paths;
- [ ] release operator records the final deployed image digests and immutable registry evidence.

## Runtime

- [x] live/readiness probes passed with real PostgreSQL, Redis, private MinIO S3, ClamAV and LibreOffice;
- [x] Telegram secret-webhook rejection, invalid update and duplicate-update/lease behavior passed against the complete stack;
- [x] clean and EICAR/mismatched/oversized upload, immutable revision, outbox and localized surfaces passed automated verification;
- [x] TOTP/lockout/CSRF, journal-scope IDOR, reviewer isolation and four-eyes decision passed real integration/E2E verification;
- [x] structured logs, request correlation IDs, dependency-aware readiness, queue retry/DLQ/restart and alert configuration passed automated verification;
- [ ] real Telegram/BotFather three-locale author restart/resume and notification-delivery smoke is signed off;
- [ ] Academy staff completes browser UAT, including invitation, signed-URL expiry, translations, reports and audit workflows;
- [ ] operations validates deployed metrics/dashboards, fires a controlled alert and records a real error-tracking event.

The required suites must report zero skipped tests. A missing `DATABASE_URL`, `REDIS_URL`, S3, ClamAV, or LibreOffice dependency is a failed release gate, not an accepted skip.

## Recovery and governance

- [x] automated encrypted backup and isolated restore proved database rows, actual object SHA-256/size/SSE and application readiness/smoke;
- [ ] production off-host backup target, encryption key custody, retention and scheduled restore-test evidence are approved;
- [ ] RPO/RTO, retention/legal hold, privacy/consent, reviewer model, journal rules, translations, and contacts approved;
- [ ] BotFather, domains, TLS, secret manager, registry, on-call, escalation, and rollback owner confirmed;
- [ ] Academy UAT `AC-001` through `AC-025` signed off.

## Current disposition

`BLOCKED` for release, not for code publication: the automated implementation and server-readiness gates pass, but no real Academy staging environment, credentials, product/linguistic/policy approvals, operations ownership or UAT sign-off were supplied. Required disposition before production is `RELEASED` with approver, exact image digests and evidence links.
