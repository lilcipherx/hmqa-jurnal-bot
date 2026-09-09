# ADR 0009: Single administrator role and standalone reviewers

- Status: accepted
- Date: 2026-09-09

## Context

The product owner replaced the earlier multi-role editorial access model. Telegram users are authors. The Admin Panel must support multiple equivalent administrator accounts but only one login role, `ADMIN`. Reviewers remain necessary to the journal workflow but are external domain contacts, not staff identities and not Admin Panel users.

Historic production data may contain former staff roles, journal scopes, reviewer-linked employees, and assignments labelled `OPERATOR` or `EDITOR`. Removing that evidence without a migration trail would make rollback and audit investigation unsafe.

## Decision

The live authorization model exposes only `AUTHOR` and `ADMIN`. Every active employee session must have an unexpired `ADMIN` membership; every administrator receives the complete backend permission set and global journal access. Administrator create/update UI and API contracts contain no role or scope selector.

Reviewers are standalone records with display name, email, phone, affiliation, expertise, and active state. They do not authenticate. Article-to-reviewer assignments reference those records and an anonymized file. Internal article responsibility references an active administrator and is stored as assignment kind `ADMIN`.

The forward migration copies former role definitions/memberships into explicit legacy archive tables before removing them from the live role catalog. Eligible former staff roles are mapped to `ADMIN`; reviewer-only identities are disabled and their sessions revoked. Legacy reviewer employee IDs are retained as historical references while live reviewer records are detached. Old operator/editor assignments are converted to `ADMIN`. Legacy enum values and old profile columns remain temporarily for read/rollback compatibility but are not accepted by current API contracts or shown in current UI.

Audit and privacy services remain implemented backend controls. They are omitted from normal navigation, as required by the product model, rather than deleted.

## Consequences

- There is no role hierarchy or journal-scope administration in the product UI.
- Four-eyes workflows distinguish different administrator identities, not different role names.
- The last-active-administrator guard and mandatory TOTP prevent accidental loss of all normal privileged access.
- Reviewer delivery remains an Academy-controlled editorial process; reviewer login is outside this product model.
- Migration rollback uses archived mappings and a reviewed forward migration; it never silently reconstructs credentials or sessions.

## Rejected alternatives

- Keeping deprecated roles hidden only in the frontend was rejected because backend authorization would still expose conflicting product behavior.
- Giving reviewers administrator credentials was rejected because it expands manuscript and PII access beyond their task.
- Destructively deleting former memberships and reviewer identity links was rejected because it would lose audit and rollback evidence.
