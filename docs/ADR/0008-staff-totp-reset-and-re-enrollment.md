# ADR 0008: Staff TOTP reset uses mandatory re-enrollment

- Status: accepted
- Date: 2026-09-09

## Context

Administrators need to recover a staff account whose authenticator is lost, while staff also need a safe self-service password and TOTP maintenance path. Permanently disabling TOTP for privileged accounts would weaken the staff authentication contract. A reset must also invalidate credentials already represented by active sessions and must not disclose a seed through logs or audit history.

## Decision

There is no ordinary permanent-disable operation. Resetting TOTP clears the encrypted current seed, marks the account as requiring re-enrollment, revokes every active staff session, revokes incomplete enrollment challenges, and appends a hash-chained audit event in one serializable transaction.

Self-service password change and TOTP reset require the current password, a valid current TOTP code, exact-origin CSRF validation, and an explicit confirmation value. Resetting another staff member additionally requires an authenticated `ADMIN` with the backend `user:manage` permission; an administrator must use the self-service path for their own account.

After reset, a correct password starts a ten-minute, single-purpose enrollment challenge. Its opaque token is stored only as a hash and is carried in a Secure, HttpOnly, SameSite=Strict cookie scoped to `/api/auth/totp`. The new seed is encrypted at rest and is disclosed only through the challenge-protected, no-store enrollment response. Completing enrollment requires a valid code generated from that new seed. Completion consumes the challenge, clears its seed copy, revokes and clears all other challenges and sessions, enables TOTP, creates a fresh authenticated session, and audits the transition atomically. Reset, replacement, completion, and expired-challenge access all erase the challenge seed ciphertext.

All normal login and enrollment paths re-check the employee and TOTP state inside a transaction. This prevents a stale or concurrent request from creating a session for an invalidated seed. Passwords, TOTP codes, seeds, enrollment tokens, cookie values, and hashes are excluded from audit snapshots and covered by logger redaction tests.

## Consequences

- `ADMIN` and `CHIEF_EDITOR` accounts cannot remain operational without TOTP after a reset; the next successful password check must proceed through re-enrollment.
- A reset intentionally signs the affected staff member out on every device.
- Recovery still requires an administrator who can complete step-up authentication. Out-of-band recovery for loss of both password and all administrator authenticators remains an operations incident, not a weaker product endpoint.
- The database stores short-lived enrollment records so service restarts do not lose the recovery flow.

## Rejected alternatives

- A persistent `totpEnabled=false` mode was rejected because it leaves privileged accounts below the required authentication baseline.
- Keeping an existing session alive after reset was rejected because that session represents the invalidated factor.
- In-memory enrollment state or a seed in a browser-readable cookie was rejected because it is neither restart-safe nor an acceptable secret boundary.
