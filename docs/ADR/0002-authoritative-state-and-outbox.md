# ADR 0002 PostgreSQL authority and transactional outbox

Status: Accepted

PostgreSQL is authoritative for users, draft state, configuration versions, submissions, file metadata, workflow, notifications, and audit. Redis is coordination infrastructure only.

Status transitions update the locked submission, append history and audit, and create a notification outbox row in one transaction. BullMQ delivery uses the outbox event ID as deterministic job ID. This prevents a committed decision without a recoverable notification event and makes retries idempotent.
