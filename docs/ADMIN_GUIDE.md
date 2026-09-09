# Administrator guide

## Access and roles

Staff accounts are invitation-only. The one-time invitation expires after 24 hours and displays the TOTP enrollment secret only to the invitee. A password must contain at least 14 characters. Five failed logins trigger a 15-minute lock. Sessions have idle and absolute expiry; sensitive decisions require a recent TOTP-backed step-up window.

The backend, not the visibility of a button, enforces permissions and journal scope:

- `OPERATOR`: technical review, assignment assistance, scoped files, and notification replay;
- `EDITOR`: editorial workflow, reviewers, messages, and prepared decisions;
- `REVIEWER`: only assigned anonymized packages and their own reviews;
- `CHIEF_EDITOR`: decision approval, publication, scoped exports, and four-eyes authority;
- `CONTENT_ADMIN`: journals, requirement versions, and translation versions;
- `ADMIN`: identities, roles, operations, and global audit, without implicit manuscript access;
- `AUDITOR`: read-only global audit/operations and non-PII exports.

## Journal setup

Create all three localizations. A journal can be `NATIVE`, `CLOSED`, `EXTERNAL_LINK`, `API_SYNC`, or archived. Only `NATIVE` with a published current requirement version and an active acceptance window appears as available for a native submission.

Requirement lifecycle is `DRAFT → REVIEW → APPROVED → PUBLISHED → RETIRED`. Approval requires an actor other than the creator. Publishing pins the version as the journal's current version. Existing drafts/submissions retain their originally acknowledged version.

Each requirement configuration also pins `workflow.reviewModel`, `workflow.requiredReviewerCount`, and `workflow.decisionRequiresCompletedReviews`. A blind model requires at least one reviewer; a no-external-review model requires zero. The `UNDER_REVIEW` transition counts only accepted, conflict-free assignments, and an editorial decision cannot bypass completed reviews when the published policy requires them.

The seed is safe by default: journals are closed, and unresolved Academy policies are not silently published.

## Submission operations

The public ID format is `HMQA-{JOURNAL}-{UTC YEAR}-{SEQUENCE}`. Receipt means `SUBMITTED`; technical registration means `REGISTERED`; neither means publication acceptance. Only a separately authorized editorial decision reaches `ACCEPTED`.

Use the submission page to:

1. inspect immutable metadata/file versions, SHA-256, scan/preflight results, requirements version, and status history;
2. upload a separately prepared anonymized DOCX/PDF package, attest the manual check, wait for signature/ClamAV/PF-015 completion, then assign an eligible reviewer and deadline;
3. send either public author messages or internal comments;
4. move status only through the allowed transition list and required guards;
5. prepare a reasoned accept/reject proposal as editor;
6. approve that proposal as a different chief editor while the step-up window is valid;
7. publish only with a publication reference.

Correction/revision requests require a public reason and deadline. The author receives a localized queued notification and can submit a new immutable version in Telegram. Old files and versions are never overwritten.

An anonymized reviewer package is an editorial derivative, not a replacement for the author's file. PF-015 reports known identifier field classes without storing matching names or manuscript excerpts and always leaves a manual-verification warning. Do not assign a package with a failed/blocking run or unresolved identifier error.

## Review workspace

Reviewers see only their assignments. They must accept or decline (decline records a conflict declaration in the current interface) before submitting a recommendation, public author comments, and optional confidential editorial comments. A completed review cannot be replaced through the UI; correction requires an audited administrative process.

## Notifications and translations

Notifications expose delivery state and attempt count. `FAILED`/`DEAD_LETTER` records can be explicitly replayed; replay increments a durable generation and is audited. Do not replay before correcting permanent Telegram/account errors.

Translation versions use the same reviewed lifecycle. Worker delivery snapshots a published database template before rendering; if none exists, the compiled, parity-tested bundle is used. Placeholder names such as `{public_id}` must match the event variables.

## Audit and reports

Audit records include actor, role, action, entity, time, before/after, hashed IP/user agent, request/correlation IDs, journal scope, and a tamper-evident previous-event hash. There is no admin delete endpoint. Journal-scoped staff cannot query events outside their scopes.

CSV reports exclude author PII and neutralize spreadsheet formulas. Export issuance is audited. Use a separately approved process for any PII-bearing report.

The Privacy section lists data-subject cases, enforces the case transition whitelist, and records decisions/execution reports. Legal holds require recent 2FA step-up and block erasure execution until released. Production erasure remains disabled until the Academy enables an approved retention policy.
