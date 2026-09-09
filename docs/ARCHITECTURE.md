# HMQA JURNAL BOT target architecture

## System boundary

Authors use an ordinary Telegram chat. Staff use a separate HTTPS admin application. PostgreSQL is the authoritative state store; Redis coordinates queues, short locks, rate limits, and caches but is never the only copy of a draft, submission, decision, or notification event.

```text
Telegram Bot API -> bot-service -> api-service -> PostgreSQL
                         |              |       -> transactional outbox
Staff browser -> nginx -> admin-web ----|       -> Redis/BullMQ -> workers
                                                    |-> Telegram delivery
Telegram file -> isolated processing -> signature/MIME -> ClamAV -> private clean S3
                    | rejected -> private quarantine S3    -> DOCX/PDF preflight
```

## Deployable components

| Component | Responsibility | Trust boundary |
|---|---|---|
| `apps/bot` | Webhook verification, update dedupe, localized Telegram navigation, registered slash commands, durable wizard commands | No direct status decisions or admin secrets |
| `apps/api` | Auth, authorization, validation, transactions, workflow, configuration, OpenAPI, audit | Sole application write authority |
| `apps/admin-web` | Localized staff UI with server-mediated secure session | Never trusted for permissions |
| `apps/worker` | Notification outbox, file pipeline, Unicode PDF submission receipts, provider delivery receipts, scheduled jobs | Queue-scoped credentials and least-privilege storage |
| `packages/database` | Prisma schema/client/migrations/seed | PostgreSQL contracts |
| `packages/domain` | Pure status/RBAC/guard logic | No transport coupling |
| `packages/contracts` | Zod request/event schemas and error envelope | Stable external/service contracts |
| `packages/i18n` | Typed locale keys, placeholder formatting, parity gates | No business-state authority |

## Data and transaction design

- UUID primary keys; immutable server-generated public ID `HMQA-{JOURNAL}-{YEAR}-{SEQUENCE}`.
- Submitted versions, requirements versions, status history, audit events, notification template snapshots, and file assets are append-only application records.
- A workflow transition uses a serializable transaction and optimistic row version, checks actor permission, journal scope, target guard, and four-eyes state, then writes status, history, audit, and outbox atomically.
- Telegram `update_id` and notification event IDs have unique constraints; mutations use optimistic versions. Claimed webhook/outbox work has a stale-lease recovery path.
- Signed object URLs are short-lived and permission-checked at issuance. Original object keys contain no PII.
- Every submitted version atomically creates a localized receipt snapshot/outbox row. A document worker renders it with an embedded Unicode font to a content-addressed private S3 object; repeat submission and download remain owner-bound and audited.

## Security design

- Staff passwords use Argon2id. TOTP is mandatory for local production accounts; recovery/reset is separately audited.
- Admin sessions are opaque, hashed in PostgreSQL, rotated after authentication/step-up, and sent only as Secure HttpOnly SameSite cookies.
- State-changing browser requests require same-origin checks plus CSRF tokens. Nginx and Fastify apply body, upload, and rate limits and security headers.
- RBAC combines role permissions, journal scope, ownership/assignment, current status, and optional step-up/four-eyes guards.
- Logs are allowlisted structured events. Tokens, cookies, file bodies, manuscript text, full email/phone, and arbitrary payloads are redacted.

## File design

`Telegram/admin derivative -> pending DB record -> shared quarantine -> bounded processing -> SHA-256 -> requirement limits -> extension -> magic MIME -> ClamAV -> DOCX/PDF safety -> clean private S3 (or separate evidence quarantine) -> immutable metadata -> preflight result`.

Scanner `ERROR` or `TIMEOUT` is never CLEAN. Originals are immutable; replacement and revision produce a new file asset and submission version. Clean-object signed URLs require owner/RBAC checks and are audited; quarantine objects have no application download path. Processing cleanup and evidence retention are monitored, bounded, and policy-controlled.

DOCX formatting rules are pinned to the acknowledged requirement version. Structural OOXML checks and a headless LibreOffice render produce explainable versioned findings without retaining manuscript excerpts. Reviewer packages are distinct editorial derivatives: staff attest manual anonymization, PF-015 stores only matched identifier classes/counts, and reviewers can download only the clean file bound to their assignment.

## Availability and rollback

- HTTP services are stateless and horizontally replicable.
- Jobs are small, idempotent, retryable, and use deterministic IDs; terminal failures are retained in a DLQ operations view.
- Database migrations use expand/contract. Application rollback uses immutable image digests; incompatible data changes use a reviewed forward fix.
- PostgreSQL logical backup and the matching S3 object set are encrypted together and verified by isolated restore plus application smoke. S3 versioning provides object-level rollback; managed PostgreSQL WAL/PITR is an additional deployment-platform control and is not claimed by this repository.
