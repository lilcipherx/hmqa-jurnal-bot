BEGIN;

-- Preserve deprecated staff-role assignments and definitions for forensic rollback.
CREATE TABLE "legacy_staff_roles" (
  "code" VARCHAR(64) PRIMARY KEY,
  "description" TEXT NOT NULL,
  "system" BOOLEAN NOT NULL,
  "permission_codes" TEXT[] NOT NULL,
  "archived_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "legacy_staff_role_memberships" (
  "employee_id" UUID NOT NULL,
  "role_code" VARCHAR(64) NOT NULL,
  "granted_by" UUID,
  "granted_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("employee_id", "role_code")
);

INSERT INTO "legacy_staff_roles" ("code", "description", "system", "permission_codes")
SELECT r."code", r."description", r."system",
       COALESCE(array_agg(p."code" ORDER BY p."code") FILTER (WHERE p."code" IS NOT NULL), ARRAY[]::TEXT[])
FROM "roles" r
LEFT JOIN "role_permissions" rp ON rp."role_id" = r."id"
LEFT JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" <> 'ADMIN'
GROUP BY r."id";

INSERT INTO "legacy_staff_role_memberships" (
  "employee_id", "role_code", "granted_by", "granted_at", "expires_at"
)
SELECT er."employee_id", r."code", er."granted_by", er."granted_at", er."expires_at"
FROM "employee_roles" er
JOIN "roles" r ON r."id" = er."role_id"
WHERE r."code" <> 'ADMIN';

INSERT INTO "roles" ("id", "code", "description", "system", "created_at")
VALUES (gen_random_uuid(), 'ADMIN', 'ADMIN', TRUE, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description", "system" = TRUE;

INSERT INTO "employee_roles" ("employee_id", "role_id", "granted_at", "expires_at")
SELECT er."employee_id", admin_role."id", CURRENT_TIMESTAMP,
       CASE
         WHEN bool_or(er."expires_at" IS NULL) THEN NULL
         ELSE max(er."expires_at")
       END
FROM "employee_roles" er
JOIN "roles" legacy_role ON legacy_role."id" = er."role_id"
CROSS JOIN "roles" admin_role
WHERE admin_role."code" = 'ADMIN'
  AND legacy_role."code" IN ('OPERATOR', 'EDITOR', 'CHIEF_EDITOR', 'CONTENT_ADMIN', 'AUDITOR')
  AND (er."expires_at" IS NULL OR er."expires_at" > CURRENT_TIMESTAMP)
GROUP BY er."employee_id", admin_role."id"
ON CONFLICT ("employee_id", "role_id") DO UPDATE
SET "expires_at" = CASE
  WHEN "employee_roles"."expires_at" IS NULL OR EXCLUDED."expires_at" IS NULL THEN NULL
  ELSE GREATEST("employee_roles"."expires_at", EXCLUDED."expires_at")
END;

-- Reviewer/author-only legacy staff identities no longer authenticate to the Admin Panel.
UPDATE "staff_sessions" ss
SET "revoked_at" = COALESCE(ss."revoked_at", CURRENT_TIMESTAMP)
WHERE NOT EXISTS (
  SELECT 1
  FROM "employee_roles" er
  JOIN "roles" r ON r."id" = er."role_id"
  WHERE er."employee_id" = ss."employee_id"
    AND r."code" = 'ADMIN'
    AND (er."expires_at" IS NULL OR er."expires_at" > CURRENT_TIMESTAMP)
);

UPDATE "employees" e
SET "status" = 'DISABLED'
WHERE EXISTS (
  SELECT 1 FROM "legacy_staff_role_memberships" legacy
  WHERE legacy."employee_id" = e."id"
)
AND NOT EXISTS (
  SELECT 1
  FROM "employee_roles" er
  JOIN "roles" r ON r."id" = er."role_id"
  WHERE er."employee_id" = e."id"
    AND r."code" = 'ADMIN'
    AND (er."expires_at" IS NULL OR er."expires_at" > CURRENT_TIMESTAMP)
);

DELETE FROM "employee_roles" er
USING "roles" r
WHERE er."role_id" = r."id" AND r."code" <> 'ADMIN';

DELETE FROM "role_permissions" rp
USING "roles" r
WHERE rp."role_id" = r."id";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'ADMIN'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "roles" WHERE "code" <> 'ADMIN';

-- Replace old staff-role assignment semantics with a single administrator responsibility.
-- Rebuild the enum so the migration remains safe even when the migration runner wraps
-- the file in a transaction (PostgreSQL cannot use a freshly-added enum value before commit).
CREATE TYPE "AssignmentKind_next" AS ENUM ('ADMIN', 'OPERATOR', 'EDITOR', 'REVIEWER');
ALTER TABLE "assignments"
  ALTER COLUMN "kind" TYPE "AssignmentKind_next"
  USING (
    CASE
      WHEN "kind"::TEXT IN ('OPERATOR', 'EDITOR') THEN 'ADMIN'
      ELSE "kind"::TEXT
    END
  )::"AssignmentKind_next";
DROP TYPE "AssignmentKind";
ALTER TYPE "AssignmentKind_next" RENAME TO "AssignmentKind";

-- Keep legacy author attributes in place while introducing the normalized seven-field profile.
ALTER TABLE "author_profiles"
  ADD COLUMN "full_name" VARCHAR(300),
  ADD COLUMN "degree_code" VARCHAR(32),
  ADD COLUMN "degree_custom" VARCHAR(200),
  ADD COLUMN "title_code" VARCHAR(32),
  ADD COLUMN "title_custom" VARCHAR(200);

UPDATE "author_profiles"
SET "full_name" = trim(concat_ws(' ', "last_name", "first_name", "middle_name")),
    "degree_code" = CASE WHEN "degree" IS NULL OR trim("degree") IN ('', '-') THEN 'NONE' ELSE 'OTHER' END,
    "degree_custom" = CASE WHEN "degree" IS NULL OR trim("degree") IN ('', '-') THEN NULL ELSE "degree" END,
    "title_code" = CASE WHEN "academic_title" IS NULL OR trim("academic_title") IN ('', '-') THEN 'NONE' ELSE 'OTHER' END,
    "title_custom" = CASE WHEN "academic_title" IS NULL OR trim("academic_title") IN ('', '-') THEN NULL ELSE "academic_title" END;

-- Reviewers become standalone domain contacts. The old login association is archived, not lost.
ALTER TABLE "reviewers"
  ADD COLUMN "legacy_employee_id" UUID,
  ADD COLUMN "display_name" VARCHAR(200),
  ADD COLUMN "email" CITEXT,
  ADD COLUMN "phone" VARCHAR(32);

UPDATE "reviewers" r
SET "legacy_employee_id" = r."employee_id",
    "display_name" = e."display_name",
    "email" = e."email"
FROM "employees" e
WHERE e."id" = r."employee_id";

ALTER TABLE "reviewers" ALTER COLUMN "display_name" SET NOT NULL;
ALTER TABLE "reviewers" ALTER COLUMN "employee_id" DROP NOT NULL;
UPDATE "reviewers" SET "employee_id" = NULL;

CREATE TABLE "contact_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_key" VARCHAR(100) NOT NULL,
  "journal_id" UUID,
  "phone" VARCHAR(32),
  "email" CITEXT,
  "telegram" VARCHAR(100),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "contact_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contact_profiles_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contact_profiles_scope_key_key" ON "contact_profiles"("scope_key");
CREATE UNIQUE INDEX "contact_profiles_journal_id_key" ON "contact_profiles"("journal_id");

CREATE TABLE "contact_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contact_profile_id" UUID NOT NULL,
  "locale" "Locale" NOT NULL,
  "address" TEXT,
  "working_hours" TEXT,
  "note" TEXT,
  CONSTRAINT "contact_localizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contact_localizations_contact_profile_id_fkey" FOREIGN KEY ("contact_profile_id") REFERENCES "contact_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contact_localizations_contact_profile_id_locale_key"
  ON "contact_localizations"("contact_profile_id", "locale");

-- Preserve existing journal contact copy as the localized note of a structured contact.
INSERT INTO "contact_profiles" ("id", "scope_key", "journal_id", "updated_at")
SELECT gen_random_uuid(), 'JOURNAL:' || j."id"::TEXT, j."id", CURRENT_TIMESTAMP
FROM "journals" j
WHERE EXISTS (
  SELECT 1
  FROM "journal_localizations" jl
  WHERE jl."journal_id" = j."id"
    AND NULLIF(trim(jl."contact_text"), '') IS NOT NULL
);

INSERT INTO "contact_localizations" (
  "id", "contact_profile_id", "locale", "note"
)
SELECT gen_random_uuid(), cp."id", jl."locale", jl."contact_text"
FROM "journal_localizations" jl
JOIN "contact_profiles" cp ON cp."journal_id" = jl."journal_id"
WHERE NULLIF(trim(jl."contact_text"), '') IS NOT NULL;

CREATE TABLE "bot_content" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(100) NOT NULL,
  "locale" "Locale" NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "bot_content_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_content_key_locale_key" ON "bot_content"("key", "locale");

COMMIT;
