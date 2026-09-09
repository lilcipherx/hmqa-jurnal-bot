# Contributing to HMQA JURNAL BOT

Thank you for helping improve the project. Contributions must preserve the Markdown PRD as the primary product authority and must not introduce a Telegram Mini App.

## Development workflow

1. Create a focused branch from `main`.
2. Never commit credentials, `.env` files, real manuscripts, staff details, database dumps, or production logs.
3. Keep user-facing text in `@hmqa/i18n` and update all three locales: `uz-Latn`, `ru`, and `en`.
4. Add a migration for schema changes; do not rewrite migrations that have already shipped.
5. Add regression tests for behavior changes, especially workflow, RBAC, file security, and idempotency.
6. Run the complete local gate:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm db:generate
   pnpm compose:validate
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm build
   pnpm test
   pnpm test:i18n
   pnpm security:secrets
   pnpm security:public
   pnpm audit --audit-level moderate
   ```

7. When Docker is available, run `pnpm verify:runtime`. Required integration/runtime suites must contain zero skipped tests.

Use conventional, focused commit prefixes such as `fix:`, `test:`, `ci:`, `docs:`, and `security:`. Pull requests should describe the requirement, migration/rollback impact, verification evidence, and any Academy-owned decision that remains open.

Security vulnerabilities must not be filed as public issues; follow [SECURITY.md](SECURITY.md).
