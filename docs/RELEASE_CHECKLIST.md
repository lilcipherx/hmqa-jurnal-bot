# Release checklist

Record date, candidate Git SHA/image digests, operator, environment, and links to immutable evidence. A blank item is not a pass.

## Quality

- [ ] `pnpm verify:runtime` passed for the exact candidate and its JSON evidence was retained;
- [ ] clean `pnpm install --frozen-lockfile`, format, lint, typecheck, unit, integration, E2E, and build;
- [ ] moderate-or-higher dependency audit, secret scan, SHA-pinned action review, and CodeQL pass;
- [ ] public audit covers tracked paths, reachable Git blobs, PII heuristics, forbidden archives/keys, and confirms no unreviewed `LICENSE` grant;
- [ ] clean-database migrations and twice-run seed pass;
- [ ] requirement-to-evidence matrix reviewed with no mandatory placeholder/TODO path.

## Runtime

- [ ] all live/readiness probes pass with real PostgreSQL, Redis, private S3, and ClamAV;
- [ ] Telegram secret webhook and update retry/lease behavior verified;
- [ ] three-locale author journey, persisted restart/resume, clean and malicious upload, revision, and notifications verified;
- [ ] staff invitation/TOTP/lockout/CSRF, journal-scope IDOR, reviewer isolation, four-eyes decision, and signed URL expiry verified;
- [ ] metrics, alerts, Sentry event, queue depth, dead-letter replay, and correlation IDs verified.

The required suites must report zero skipped tests. A missing `DATABASE_URL`, `REDIS_URL`, S3, ClamAV, or LibreOffice dependency is a failed release gate, not an accepted skip.

## Recovery and governance

- [ ] encrypted off-host backup succeeds and isolated restore proves DB/object integrity and application smoke;
- [ ] RPO/RTO, retention/legal hold, privacy/consent, reviewer model, journal rules, translations, and contacts approved;
- [ ] BotFather, domains, TLS, secret manager, registry, on-call, escalation, and rollback owner confirmed;
- [ ] Academy UAT `AC-001` through `AC-025` signed off.

Final disposition: `RELEASED`, `BLOCKED`, or `REJECTED`, with approver and rationale.
