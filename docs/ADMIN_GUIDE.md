# Administrator guide

## Initial administrator bootstrap

Never run the development seed in staging or production. After forward migrations on a clean environment, create the first administrator through the interactive one-time invitation:

```bash
docker compose --env-file .env.production run --rm -it api pnpm --filter @hmqa/database bootstrap:admin
```

The command asks only for the approved email and display name, creates the canonical `ADMIN` membership, and prints a single-use 24-hour invitation URL. It never accepts or prints a password. Open the URL over trusted HTTPS, set a strong unique password, enroll TOTP, and complete activation. The bootstrap refuses to create a second initial administrator.

## Administrators and access

The Admin Panel has one login role: `ADMIN`. More than one administrator account is supported, and every active administrator has the same complete product access. Former operator/editor/chief-editor/content-admin/auditor/reviewer role names are not selectable roles. Reviewers are standalone journal contacts and never authenticate to the Admin Panel.

Invite another administrator from **Administrators**. Invitations are single-use and expire after 24 hours. A password must contain at least 14 characters. Five failed logins trigger a 15-minute lock. Sessions have idle and absolute expiry, and sensitive account operations require a current password plus TOTP step-up and explicit confirmation.

### Password and TOTP maintenance

Use **Settings → Security** to change your own password or reset and re-enroll TOTP. Enter the current password and current authenticator code, review the warning, and explicitly confirm. A successful password change or TOTP reset signs the account out on every device.

An administrator can use **Administrators → Reset 2FA** for another administrator. The acting administrator provides their own current password and TOTP and confirms the operation. The action invalidates the target's old secret and all target sessions; it never reveals a replacement secret. At the target's next password-authenticated login, the application requires enrollment of a newly generated TOTP secret. The enrollment challenge expires after ten minutes.

There is no normal permanent-disable flow. An administrator whose TOTP was reset cannot use the panel until re-enrollment is complete. If all administrators lose both password and authenticator access, follow the Academy credential-recovery incident procedure; never create an untracked account or edit credential fields manually.

## Navigation

Normal navigation contains exactly these product areas:

1. Dashboard
2. Articles
3. Journals
4. Reviewers
5. Telegram bot
6. Notifications
7. Administrators
8. Settings

The panel language switcher supports Uzbek, Russian, and English, persists the choice in a cookie, and returns to the current page. Audit and privacy machinery remain backend controls but are intentionally absent from normal navigation.

## Journal and Telegram content setup

Create all three journal localizations. A journal can be `NATIVE`, `CLOSED`, `EXTERNAL_LINK`, `API_SYNC`, or archived. Only `NATIVE` with a published current requirement version and an active acceptance window appears for native submission.

Use **+ Add journal** to enter the basic data, three localized descriptions and contacts, submission settings, and acceptance dates. Requirement versions use structured controls rather than a JSON editor. A draft can be previewed in UZ/RU/EN and edited with optimistic locking; a version in review can be returned to draft. Approval follows the four-eyes rule, and publishing explicitly marks that version as the active version read by Telegram. Earlier versions remain visible and immutable as history.

Requirement lifecycle is `DRAFT → REVIEW → APPROVED → PUBLISHED → RETIRED`. Approval requires a second administrator when four-eyes approval is enabled. Publishing pins the current version; existing drafts and submissions retain the version they acknowledged.

Use **Telegram bot** to manage localized Help content and contacts. A global contact can contain phone, email, Telegram username, address, working hours, and note. A journal-specific contact overrides only populated fields; missing fields fall back to the global contact. User-facing content uses the user's selected locale with the documented locale fallback policy.

## Author profile

The author profile has seven conceptual fields: full name, phone, email, organization, position, scientific degree, and academic title. Degree and title use normalized codes with localized choices and an explicit custom **Other** value. Country, city, and ORCID are retained only as legacy database columns and must not be requested or shown in the current Telegram flow.

## Submission operations

The public ID format is `HMQA-{JOURNAL}-{UTC YEAR}-{SEQUENCE}`. Receipt means `SUBMITTED`; technical registration means `REGISTERED`; neither means publication acceptance. Only a separate editorial decision reaches `ACCEPTED`.

Use the article page to inspect immutable metadata/file versions, scan and preflight results, the pinned requirements version, comments, status history, reviewer assignments, and decisions. Administrators can assign another active administrator to internal processing; there is no staff-role selector. A reviewer is selected from the standalone reviewer directory and receives the specifically prepared anonymized package according to Academy policy.

Correction or revision requests require a public reason and deadline. The author receives a localized queued notification and submits a new immutable version through Telegram. Old files and versions are never overwritten.

## Reviewers

Reviewers are domain records containing name, email, optional phone, affiliation, expertise, and active state. They are not employees, administrator accounts, or role memberships. Administrators create and edit reviewer contacts, prepare an anonymized derivative, assign it with a deadline, and record the returned review through the editorial workflow. Never provide a reviewer with an administrator credential merely to deliver a manuscript.

## Notifications, audit, and reports

Notification records expose delivery state and attempt count. Failed/dead-letter records can be replayed after the permanent cause is corrected; replay is durable and audited.

Audit records include actor, role, action, entity, time, before/after, hashed network data, request/correlation IDs, and a tamper-evident previous-event hash. There is no application delete endpoint. Audit is retained as a backend/operations control even though it is not a normal navigation item.

CSV exports neutralize spreadsheet formulas and exclude author PII by default. Privacy cases and legal holds remain backend capabilities governed by Academy policy; no privacy-request button is exposed in Telegram and no privacy section is exposed in normal Admin Panel navigation.
