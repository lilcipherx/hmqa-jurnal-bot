# Security model

## Trust boundaries and data

Telegram and staff browsers are untrusted transports. Only the API is an application write authority. Redis is coordination infrastructure, never the sole source for drafts or decisions. Clean manuscripts live in a private S3 bucket. Processing uses a bounded ephemeral worker directory; rejected/malicious evidence is encrypted into a separate private quarantine bucket and is never exposed through author or staff download endpoints.

Sensitive fields include author contact data, manuscripts, review identities/comments, credentials, TOTP seeds, sessions, service secrets, and provider tokens. Contact data and TOTP seeds are encrypted at application level; lookup fingerprints are one-way hashes. Logs redact authorization/cookies/tokens/passwords/secrets and do not log request bodies.

## Implemented controls

- Argon2id passwords, mandatory TOTP enrollment, brute-force lockout, opaque hashed sessions, idle/absolute expiry, Secure HttpOnly SameSite cookies, and short decision step-up;
- CSRF token plus exact-origin validation for every browser mutation; restrictive CORS, CSP, security headers, body limits, and API/nginx rate limiting;
- compile-time role/permission matrix plus journal scope, assignment/ownership, workflow guard, optimistic concurrency, and four-eyes checks on the backend;
- Telegram webhook secret checked in constant time, update envelope validated before grammY dispatch, and update IDs held with recoverable idempotency leases;
- requirement-version-bound category/format/size limits, declared-MIME versus detected-signature comparison, magic MIME, DOCX ZIP structure/bomb/encryption/macro checks, passive-PDF action checks, SHA-256, ClamAV fail-closed behavior (including a distinct retryable timeout state), path/header-safe untrusted filenames, immutable object keys, separate private clean/quarantine buckets, SSE, and ownership/RBAC-checked expiring downloads;
- resource-limited headless DOCX rendering, non-leaking formatting evidence, and journal-scoped editorial reviewer-package upload with attestation plus PF-015 identifier-class detection;
- durable data-subject request workflow, backend privacy permissions, recent-2FA legal holds, erasure execution gates, and non-destructive retention defaults;
- serializable workflow transaction writes status, history, notification outbox, and hash-chained audit together;
- notification claim leases, deterministic queue IDs, exponential retry, terminal dead-letter state, and audited replay generations;
- Sentry configured without default PII, Prometheus metrics, health probes, alerts, secret scanning, dependency audit, SHA-pinned CI actions, and CodeQL. The AWS SDK packages are kept in lockstep; the 2026 `fast-xml-parser` transitive advisories are removed from the locked graph and the moderate-level audit passes.
- public-source history scanning covers forbidden paths and every reachable Git blob; CI executes untrusted fork code only on disposable hosted runners with read-only repository permissions and no production secrets.

## Secret rotation

Rotate service/webhook/session/S3/backup credentials independently. Rotating `ENCRYPTION_KEY` requires a versioned re-encryption migration because ciphertext carries a format version but currently uses one configured key. Revoke all staff sessions after session-secret compromise. Update the BotFather webhook secret and deployment atomically.

Never put production secrets in Git, images, Compose YAML, seed data, issue comments, or ordinary logs.

## Residual and external controls

- Select and configure the Academy identity provider or explicitly approve local production authentication.
- Approve retention/legal-hold, privacy, reviewer anonymity, and incident notification policies.
- Put TLS, WAF/DDoS controls, network policy, host patching, registry scanning/signing, and secret manager around the supplied containers.
- Run ClamAV definition freshness monitoring and periodic adversarial upload tests.
- Restrict direct database users: application roles must not own the database or receive arbitrary audit-table DELETE/UPDATE privileges.

The tracked synthetic runtime configuration is never a production secret source. Its values, Telegram API server, EICAR construction, and local recovery volumes exist only under `.env.test.example`/`docker-compose.test.yml` and are labelled `DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL`. The default Compose file still requires an operator-provided `.env` and real Telegram API endpoint.

The default Docker target is assembled only from built application/package artifacts, package metadata, and forward migrations; it does not copy repository tests or `.env*` files. The Compose acceptance override explicitly selects the separate `verification` target for runtime fixtures.

## Incident response

1. Contain by closing journal intake, pausing bot ingress/workers, or revoking sessions/credentials without deleting evidence.
2. Correlate nginx, application, queue, Sentry, and audit events by request/correlation ID.
3. For malware, isolate object/quarantine evidence and never mark scanner error/timeout as clean.
4. For credential compromise, rotate the affected secret and examine access/audit trails and signed-URL issuance.
5. Recover through reviewed forward fixes or the documented isolated restore procedure.
6. Record timeline, scope, notifications, remediation, and evidence retention under Academy policy.
