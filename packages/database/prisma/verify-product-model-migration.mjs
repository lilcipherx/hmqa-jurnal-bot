import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import pg from 'pg';

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL is required');

const prismaDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = dirname(prismaDirectory);
const migrationDirectory = join(
  prismaDirectory,
  'migrations',
  '202609090004_simplified_admin_product',
);
const heldDirectory = join(packageDirectory, `.held-product-model-migration-${process.pid}`);
const databaseName = `hmqa_upgrade_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
let migrationHeld = false;
let databaseCreated = false;

function migrate() {
  execFileSync(pnpm, ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: packageDirectory,
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'inherit',
  });
}

async function scalar(client, sql, parameters = []) {
  const result = await client.query(sql, parameters);
  return result.rows[0]?.value;
}

const control = new pg.Client({ connectionString: sourceUrl });
try {
  if (!existsSync(migrationDirectory)) throw new Error('Product-model migration is unavailable');
  await control.connect();
  await control.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;

  renameSync(migrationDirectory, heldDirectory);
  migrationHeld = true;
  migrate();

  const authorProfileId = randomUUID();
  const journalId = randomUUID();
  const submissionId = randomUUID();
  const assignmentId = randomUUID();
  const fixture = new pg.Client({ connectionString: testUrl.toString() });
  await fixture.connect();
  try {
    const adminRoleId = randomUUID();
    const operatorRoleId = randomUUID();
    const reviewerRoleId = randomUUID();
    const permissionId = randomUUID();
    const existingAdminId = randomUUID();
    const operatorId = randomUUID();
    const expiredOperatorId = randomUUID();
    const reviewerEmployeeId = randomUUID();
    const reviewerId = randomUUID();
    const authorId = randomUUID();
    const requirementId = randomUUID();
    await fixture.query(
      `INSERT INTO "permissions" ("id", "code", "description") VALUES ($1, 'journal:read', 'journal:read')`,
      [permissionId],
    );
    await fixture.query(
      `INSERT INTO "roles" ("id", "code", "description") VALUES
       ($1, 'ADMIN', 'legacy administrator'),
       ($2, 'OPERATOR', 'legacy operator'),
       ($3, 'REVIEWER', 'legacy reviewer')`,
      [adminRoleId, operatorRoleId, reviewerRoleId],
    );
    await fixture.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES ($1, $4), ($2, $4), ($3, $4)`,
      [adminRoleId, operatorRoleId, reviewerRoleId, permissionId],
    );
    await fixture.query(
      `INSERT INTO "employees" ("id", "email", "display_name", "status", "updated_at") VALUES
       ($1, 'upgrade-admin@example.invalid', 'Upgrade Admin', 'ACTIVE', CURRENT_TIMESTAMP),
       ($2, 'upgrade-operator@example.invalid', 'Upgrade Operator', 'ACTIVE', CURRENT_TIMESTAMP),
       ($3, 'upgrade-expired@example.invalid', 'Expired Upgrade Operator', 'ACTIVE', CURRENT_TIMESTAMP),
       ($4, 'upgrade-reviewer@example.invalid', 'Upgrade Reviewer', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [existingAdminId, operatorId, expiredOperatorId, reviewerEmployeeId],
    );
    await fixture.query(
      `INSERT INTO "employee_roles" ("employee_id", "role_id", "expires_at") VALUES
       ($1, $5, NULL),
       ($2, $6, CURRENT_TIMESTAMP + INTERVAL '1 day'),
       ($2, $5, CURRENT_TIMESTAMP - INTERVAL '1 day'),
       ($3, $6, CURRENT_TIMESTAMP - INTERVAL '1 day'),
       ($4, $7, NULL)`,
      [
        existingAdminId,
        operatorId,
        expiredOperatorId,
        reviewerEmployeeId,
        adminRoleId,
        operatorRoleId,
        reviewerRoleId,
      ],
    );
    await fixture.query(
      `INSERT INTO "staff_sessions" (
         "id", "employee_id", "token_hash", "csrf_hash", "two_factor_at", "expires_at"
       ) VALUES
       ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour'),
       ($5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
      [
        randomUUID(),
        operatorId,
        '1'.repeat(64),
        '2'.repeat(64),
        randomUUID(),
        reviewerEmployeeId,
        '3'.repeat(64),
        '4'.repeat(64),
      ],
    );
    await fixture.query(
      `INSERT INTO "reviewers" (
         "id", "employee_id", "expertise", "affiliation", "updated_at"
       ) VALUES ($1, $2, '["criminal law"]'::jsonb, 'Upgrade Academy', CURRENT_TIMESTAMP)`,
      [reviewerId, reviewerEmployeeId],
    );
    await fixture.query(
      `INSERT INTO "users" ("id", "telegram_user_id", "updated_at")
       VALUES ($1, 990000000001, CURRENT_TIMESTAMP)`,
      [authorId],
    );
    await fixture.query(
      `INSERT INTO "author_profiles" (
         "id", "user_id", "first_name", "last_name", "middle_name",
         "phone_cipher", "phone_hash", "email_cipher", "email_hash",
         "organization", "position", "degree", "academic_title",
         "country", "city", "orcid", "updated_at"
       ) VALUES (
         $1, $2, 'Legacy', 'Author', 'Profile',
         'encrypted-phone', $3, 'encrypted-email', $4,
         'Upgrade Academy', 'Researcher', 'PhD legacy label', 'Professor legacy label',
         'Uzbekistan', 'Tashkent', '0000-0002-1825-0097', CURRENT_TIMESTAMP
       )`,
      [authorProfileId, authorId, '5'.repeat(64), '6'.repeat(64)],
    );
    await fixture.query(
      `INSERT INTO "journals" ("id", "code", "updated_at")
       VALUES ($1, 'UPGRADE', CURRENT_TIMESTAMP)`,
      [journalId],
    );
    await fixture.query(
      `INSERT INTO "journal_localizations" (
         "id", "journal_id", "locale", "name", "short_name", "description", "contact_text", "updated_at"
       ) VALUES (
         $1, $2, 'ru', 'Upgrade Journal', 'UPGRADE', 'Legacy journal',
         'Legacy editorial contact', CURRENT_TIMESTAMP
       )`,
      [randomUUID(), journalId],
    );
    await fixture.query(
      `INSERT INTO "journal_requirement_versions" (
         "id", "journal_id", "version", "config", "config_hash", "change_note"
       ) VALUES ($1, $2, 1, '{}'::jsonb, $3, 'legacy requirement')`,
      [requirementId, journalId, '7'.repeat(64)],
    );
    await fixture.query(
      `INSERT INTO "submissions" (
         "id", "public_id", "journal_id", "owner_id", "requirement_version_id"
       ) VALUES ($1, 'UPGRADE-ARTICLE-001', $2, $3, $4)`,
      [submissionId, journalId, authorId, requirementId],
    );
    await fixture.query(
      `INSERT INTO "assignments" (
         "id", "submission_id", "employee_id", "journal_id", "kind", "reason", "assigned_by_id"
       ) VALUES ($1, $2, $3, $4, 'EDITOR', 'legacy editorial assignment', $5)`,
      [assignmentId, submissionId, operatorId, journalId, existingAdminId],
    );
  } finally {
    await fixture.end();
  }

  renameSync(heldDirectory, migrationDirectory);
  migrationHeld = false;
  migrate();

  const verified = new pg.Client({ connectionString: testUrl.toString() });
  await verified.connect();
  try {
    const liveRoles = await verified.query(`SELECT "code" FROM "roles" ORDER BY "code"`);
    if (JSON.stringify(liveRoles.rows.map(({ code }) => code)) !== JSON.stringify(['ADMIN']))
      throw new Error('Live role catalog was not reduced to ADMIN');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value FROM "legacy_staff_roles" WHERE "code" IN ('OPERATOR', 'REVIEWER')`,
      )) !== 2
    )
      throw new Error('Legacy role definitions were not archived');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "employees" e
         JOIN "employee_roles" er ON er."employee_id" = e."id"
         JOIN "roles" r ON r."id" = er."role_id"
         WHERE e."email" = 'upgrade-operator@example.invalid'
           AND e."status" = 'ACTIVE'
           AND r."code" = 'ADMIN'
           AND er."expires_at" IS NOT NULL
           AND er."expires_at" > CURRENT_TIMESTAMP`,
      )) !== 1
    )
      throw new Error('Eligible legacy staff was not mapped to ADMIN');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "employees" e
         WHERE e."email" = 'upgrade-expired@example.invalid'
           AND e."status" = 'DISABLED'
           AND NOT EXISTS (
             SELECT 1 FROM "employee_roles" er
             JOIN "roles" r ON r."id" = er."role_id"
             WHERE er."employee_id" = e."id" AND r."code" = 'ADMIN'
           )`,
      )) !== 1
    )
      throw new Error('Expired legacy staff access was incorrectly promoted to ADMIN');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "employees" e
         WHERE e."email" = 'upgrade-reviewer@example.invalid' AND e."status" = 'DISABLED'`,
      )) !== 1
    )
      throw new Error('Reviewer-only login identity was not disabled');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "staff_sessions" s
         JOIN "employees" e ON e."id" = s."employee_id"
         WHERE e."email" = 'upgrade-reviewer@example.invalid' AND s."revoked_at" IS NOT NULL`,
      )) !== 1
    )
      throw new Error('Reviewer-only active session was not revoked');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "reviewers" r
         JOIN "employees" e ON e."id" = r."legacy_employee_id"
         WHERE e."email" = 'upgrade-reviewer@example.invalid'
           AND r."employee_id" IS NULL
           AND r."display_name" = 'Upgrade Reviewer'
           AND r."email" = 'upgrade-reviewer@example.invalid'`,
      )) !== 1
    )
      throw new Error('Reviewer contact was not safely detached from login identity');
    const assignmentKinds = await verified.query(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'AssignmentKind' ORDER BY enumsortorder`,
    );
    if (!assignmentKinds.rows.some(({ enumlabel }) => enumlabel === 'ADMIN'))
      throw new Error('ADMIN assignment kind is unavailable');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "assignments"
         WHERE "id" = $1 AND "submission_id" = $2 AND "kind" = 'ADMIN'`,
        [assignmentId, submissionId],
      )) !== 1
    )
      throw new Error('Legacy editorial assignment was not mapped without losing the article');
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "author_profiles"
         WHERE "id" = $1
           AND "full_name" = 'Author Legacy Profile'
           AND "degree_code" = 'OTHER'
           AND "degree_custom" = 'PhD legacy label'
           AND "title_code" = 'OTHER'
           AND "title_custom" = 'Professor legacy label'
           AND "country" = 'Uzbekistan'
           AND "city" = 'Tashkent'
           AND "orcid" = '0000-0002-1825-0097'`,
        [authorProfileId],
      )) !== 1
    )
      throw new Error(
        'Legacy author profile was not normalized while preserving historical fields',
      );
    for (const table of ['contact_profiles', 'contact_localizations', 'bot_content']) {
      if ((await scalar(verified, `SELECT to_regclass($1) IS NOT NULL AS value`, [table])) !== true)
        throw new Error(`Expected table ${table} is unavailable`);
    }
    if (
      (await scalar(
        verified,
        `SELECT count(*)::int AS value
         FROM "contact_profiles" cp
         JOIN "contact_localizations" cl ON cl."contact_profile_id" = cp."id"
         WHERE cp."journal_id" = $1
           AND cl."locale" = 'ru'
           AND cl."note" = 'Legacy editorial contact'`,
        [journalId],
      )) !== 1
    )
      throw new Error('Legacy journal contact text was not preserved');
  } finally {
    await verified.end();
  }
  process.stdout.write('legacy-to-single-admin migration verification passed\n');
} finally {
  if (migrationHeld && existsSync(heldDirectory)) renameSync(heldDirectory, migrationDirectory);
  if (databaseCreated) {
    await control.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await control.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  }
  await control.end().catch(() => undefined);
}
