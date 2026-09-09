-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Required for case-insensitive staff email uniqueness.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('uz-Latn', 'ru', 'en');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "JournalMode" AS ENUM ('NATIVE', 'EXTERNAL_LINK', 'API_SYNC', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PublicationState" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'TECHNICAL_REVIEW', 'NEEDS_CORRECTION', 'REGISTERED', 'EDITORIAL_REVIEW', 'UNDER_REVIEW', 'REVISION_REQUESTED', 'REVISION_SUBMITTED', 'ACCEPTED', 'REJECTED', 'COPYEDITING', 'LAYOUT', 'PUBLISHED', 'WITHDRAWN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SUSPICIOUS', 'ERROR', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "FileStorageStatus" AS ENUM ('PENDING', 'QUARANTINED', 'STORED', 'DELETED');

-- CreateEnum
CREATE TYPE "PreflightStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('BLOCKING', 'ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('OPERATOR', 'EDITOR', 'REVIEWER');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('ACCEPT', 'MINOR_REVISION', 'MAJOR_REVISION', 'REJECT');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'RETRYING', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'EMPLOYEE', 'SERVICE', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "telegram_chat_id" BIGINT,
    "username" VARCHAR(64),
    "locale" "Locale",
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "blocked_reason_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "author_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "phone_cipher" TEXT NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "email_cipher" TEXT NOT NULL,
    "email_hash" CHAR(64) NOT NULL,
    "organization" VARCHAR(300) NOT NULL,
    "position" VARCHAR(200) NOT NULL,
    "degree" VARCHAR(200),
    "academic_title" VARCHAR(200),
    "country" VARCHAR(100),
    "city" VARCHAR(100),
    "orcid" VARCHAR(19),
    "verified_at" TIMESTAMPTZ(6),
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "author_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "locale" "Locale" NOT NULL,
    "fingerprint" VARCHAR(128),
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "update_id" BIGINT NOT NULL,
    "user_id" UUID,
    "correlation_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "outcome" VARCHAR(64),

    CONSTRAINT "telegram_updates_pkey" PRIMARY KEY ("update_id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "mode" "JournalMode" NOT NULL DEFAULT 'CLOSED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "current_requirement_id" UUID,
    "acceptance_opens_at" TIMESTAMPTZ(6),
    "acceptance_closes_at" TIMESTAMPTZ(6),
    "external_url" TEXT,
    "four_eyes_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_localizations" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "short_name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "contact_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_localizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_requirement_versions" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "PublicationState" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "config" JSONB NOT NULL,
    "config_hash" CHAR(64) NOT NULL,
    "change_note" TEXT NOT NULL,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "journal_requirement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_localizations" (
    "id" UUID NOT NULL,
    "requirement_version_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "help" TEXT,
    "contact" TEXT,

    CONSTRAINT "requirement_localizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "journal_id" UUID,
    "requirement_version_id" UUID,
    "machine_state" VARCHAR(64) NOT NULL DEFAULT 'MAIN_MENU',
    "expected_input_type" VARCHAR(64),
    "context" JSONB NOT NULL DEFAULT '{}',
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "public_id" VARCHAR(64) NOT NULL,
    "journal_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "requirement_version_id" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_versions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "profile_snapshot" JSONB NOT NULL,
    "declarations" JSONB NOT NULL,
    "change_note" TEXT,
    "submitted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_authors" (
    "id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "author_order" INTEGER NOT NULL,
    "is_corresponding" BOOLEAN NOT NULL DEFAULT false,
    "data_snapshot" JSONB NOT NULL,

    CONSTRAINT "submission_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_metadata" (
    "id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "manuscript_language" VARCHAR(32) NOT NULL,
    "article_type" VARCHAR(100) NOT NULL,
    "section_code" VARCHAR(100) NOT NULL,
    "titles" JSONB NOT NULL,
    "abstracts" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "editorial_note" TEXT,
    "fingerprint" CHAR(64) NOT NULL,

    CONSTRAINT "submission_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "source_key" VARCHAR(300),
    "object_key" TEXT,
    "quarantine_key" TEXT,
    "original_name" VARCHAR(500) NOT NULL,
    "declared_mime" VARCHAR(200),
    "detected_mime" VARCHAR(200),
    "extension" VARCHAR(32),
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64),
    "scan_status" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_engine_version" VARCHAR(100),
    "storage_status" "FileStorageStatus" NOT NULL DEFAULT 'PENDING',
    "provenance" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stored_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_files" (
    "draft_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_at" TIMESTAMPTZ(6),

    CONSTRAINT "draft_files_pkey" PRIMARY KEY ("draft_id","file_id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "required" BOOLEAN NOT NULL,
    "version_no" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preflight_runs" (
    "id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "status" "PreflightStatus" NOT NULL DEFAULT 'PENDING',
    "rule_set_version" VARCHAR(100) NOT NULL,
    "tool_version" VARCHAR(100) NOT NULL,
    "blocking_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preflight_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "password_hash" TEXT,
    "totp_secret_cipher" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'INVITED',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "disabled_at" TIMESTAMPTZ(6),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_roles" (
    "employee_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "employee_roles_pkey" PRIMARY KEY ("employee_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "employee_journal_scopes" (
    "employee_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "employee_journal_scopes_pkey" PRIMARY KEY ("employee_id","journal_id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_hash" CHAR(64) NOT NULL,
    "ip_hash" CHAR(64),
    "user_agent_hash" CHAR(64),
    "two_factor_at" TIMESTAMPTZ(6) NOT NULL,
    "step_up_until" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "kind" "AssignmentKind" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewers" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "expertise" JSONB NOT NULL,
    "affiliation" VARCHAR(300) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_assignments" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "anonymized_file_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "conflict_declared" BOOLEAN,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "review_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "review_assignment_id" UUID NOT NULL,
    "recommendation" "ReviewRecommendation" NOT NULL,
    "public_comments" TEXT NOT NULL,
    "confidential_comments" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "from_status" "SubmissionStatus" NOT NULL,
    "to_status" "SubmissionStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(64),
    "public_reason" TEXT,
    "internal_reason" TEXT,
    "correlation_id" UUID NOT NULL,
    "correction_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "submission_id" UUID,
    "user_id" UUID NOT NULL,
    "event_code" VARCHAR(100) NOT NULL,
    "locale" "Locale" NOT NULL,
    "template_version" VARCHAR(100) NOT NULL,
    "template_snapshot" JSONB NOT NULL,
    "variables" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "provider_message_id" VARCHAR(100),
    "provider_result" JSONB,
    "last_error_code" VARCHAR(100),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" UUID NOT NULL,
    "submission_id" UUID,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "visibility" "MessageVisibility" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "body" TEXT NOT NULL,
    "locale" "Locale",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "message_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("message_id","file_id")
);

-- CreateTable
CREATE TABLE "translation_keys" (
    "id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "namespace" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "translation_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_versions" (
    "id" UUID NOT NULL,
    "translation_key_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "PublicationState" NOT NULL DEFAULT 'DRAFT',
    "message" TEXT NOT NULL,
    "placeholders" JSONB NOT NULL,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(64),
    "action" VARCHAR(150) NOT NULL,
    "entity" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "outcome" VARCHAR(32) NOT NULL,
    "ip_hash" CHAR(64),
    "user_agent_hash" CHAR(64),
    "request_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "prev_hash" CHAR(64),
    "event_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" UUID,
    "locked_until" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_year_sequences" (
    "journal_code" VARCHAR(16) NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_year_sequences_pkey" PRIMARY KEY ("journal_code","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "author_profiles_user_id_key" ON "author_profiles"("user_id");

-- CreateIndex
CREATE INDEX "author_profiles_email_hash_idx" ON "author_profiles"("email_hash");

-- CreateIndex
CREATE INDEX "author_profiles_phone_hash_idx" ON "author_profiles"("phone_hash");

-- CreateIndex
CREATE INDEX "consents_user_id_scope_revoked_at_idx" ON "consents"("user_id", "scope", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "consents_user_id_policy_version_scope_granted_at_key" ON "consents"("user_id", "policy_version", "scope", "granted_at");

-- CreateIndex
CREATE INDEX "telegram_updates_received_at_idx" ON "telegram_updates"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "journals_code_key" ON "journals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journals_current_requirement_id_key" ON "journals"("current_requirement_id");

-- CreateIndex
CREATE INDEX "journals_mode_active_idx" ON "journals"("mode", "active");

-- CreateIndex
CREATE UNIQUE INDEX "journal_localizations_journal_id_locale_key" ON "journal_localizations"("journal_id", "locale");

-- CreateIndex
CREATE INDEX "journal_requirement_versions_journal_id_state_effective_at_idx" ON "journal_requirement_versions"("journal_id", "state", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "journal_requirement_versions_journal_id_version_key" ON "journal_requirement_versions"("journal_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "journal_requirement_versions_journal_id_config_hash_key" ON "journal_requirement_versions"("journal_id", "config_hash");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_localizations_requirement_version_id_locale_key" ON "requirement_localizations"("requirement_version_id", "locale");

-- CreateIndex
CREATE INDEX "drafts_user_id_deleted_at_updated_at_idx" ON "drafts"("user_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "drafts_expires_at_deleted_at_idx" ON "drafts"("expires_at", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_public_id_key" ON "submissions"("public_id");

-- CreateIndex
CREATE INDEX "submissions_journal_id_status_submitted_at_idx" ON "submissions"("journal_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "submissions_owner_id_status_submitted_at_idx" ON "submissions"("owner_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "submissions_status_submitted_at_idx" ON "submissions"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_id_current_version_no_key" ON "submissions"("id", "current_version_no");

-- CreateIndex
CREATE INDEX "submission_versions_submission_id_created_at_idx" ON "submission_versions"("submission_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "submission_versions_submission_id_version_no_key" ON "submission_versions"("submission_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "submission_authors_submission_version_id_author_order_key" ON "submission_authors"("submission_version_id", "author_order");

-- CreateIndex
CREATE UNIQUE INDEX "submission_metadata_submission_version_id_key" ON "submission_metadata"("submission_version_id");

-- CreateIndex
CREATE INDEX "submission_metadata_fingerprint_idx" ON "submission_metadata"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_source_key_key" ON "file_assets"("source_key");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_object_key_key" ON "file_assets"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_quarantine_key_key" ON "file_assets"("quarantine_key");

-- CreateIndex
CREATE INDEX "file_assets_sha256_idx" ON "file_assets"("sha256");

-- CreateIndex
CREATE INDEX "file_assets_scan_status_storage_status_created_at_idx" ON "file_assets"("scan_status", "storage_status", "created_at");

-- CreateIndex
CREATE INDEX "draft_files_draft_id_category_replaced_at_idx" ON "draft_files"("draft_id", "category", "replaced_at");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_submission_version_id_category_version_no_key" ON "submission_files"("submission_version_id", "category", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_submission_version_id_file_id_key" ON "submission_files"("submission_version_id", "file_id");

-- CreateIndex
CREATE INDEX "preflight_runs_submission_version_id_created_at_idx" ON "preflight_runs"("submission_version_id", "created_at");

-- CreateIndex
CREATE INDEX "preflight_runs_status_created_at_idx" ON "preflight_runs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_status_locked_until_idx" ON "employees"("status", "locked_until");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "employee_roles_expires_at_idx" ON "employee_roles"("expires_at");

-- CreateIndex
CREATE INDEX "employee_journal_scopes_expires_at_idx" ON "employee_journal_scopes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "staff_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "staff_sessions_employee_id_revoked_at_expires_at_idx" ON "staff_sessions"("employee_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "assignments_submission_id_kind_status_idx" ON "assignments"("submission_id", "kind", "status");

-- CreateIndex
CREATE INDEX "assignments_employee_id_status_deadline_idx" ON "assignments"("employee_id", "status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "reviewers_employee_id_key" ON "reviewers"("employee_id");

-- CreateIndex
CREATE INDEX "review_assignments_reviewer_id_status_deadline_idx" ON "review_assignments"("reviewer_id", "status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "review_assignments_submission_id_reviewer_id_assigned_at_key" ON "review_assignments"("submission_id", "reviewer_id", "assigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_review_assignment_id_key" ON "reviews"("review_assignment_id");

-- CreateIndex
CREATE INDEX "status_history_submission_id_created_at_idx" ON "status_history"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "status_history_correlation_id_idx" ON "status_history"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_event_id_key" ON "notifications"("event_id");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_created_at_idx" ON "notifications"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_threads_submission_id_key" ON "message_threads"("submission_id");

-- CreateIndex
CREATE INDEX "message_threads_user_id_status_updated_at_idx" ON "message_threads"("user_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "translation_keys_key_key" ON "translation_keys"("key");

-- CreateIndex
CREATE INDEX "translation_versions_state_locale_published_at_idx" ON "translation_versions"("state", "locale", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "translation_versions_translation_key_id_locale_version_key" ON "translation_versions"("translation_key_id", "locale", "version");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_event_hash_key" ON "audit_logs"("event_hash");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_created_at_idx" ON "audit_logs"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_hash_key" ON "idempotency_records"("scope", "key_hash");

-- AddForeignKey
ALTER TABLE "author_profiles" ADD CONSTRAINT "author_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_current_requirement_id_fkey" FOREIGN KEY ("current_requirement_id") REFERENCES "journal_requirement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_localizations" ADD CONSTRAINT "journal_localizations_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_requirement_versions" ADD CONSTRAINT "journal_requirement_versions_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_localizations" ADD CONSTRAINT "requirement_localizations_requirement_version_id_fkey" FOREIGN KEY ("requirement_version_id") REFERENCES "journal_requirement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_requirement_version_id_fkey" FOREIGN KEY ("requirement_version_id") REFERENCES "journal_requirement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_requirement_version_id_fkey" FOREIGN KEY ("requirement_version_id") REFERENCES "journal_requirement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_authors" ADD CONSTRAINT "submission_authors_submission_version_id_fkey" FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_metadata" ADD CONSTRAINT "submission_metadata_submission_version_id_fkey" FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_files" ADD CONSTRAINT "draft_files_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_files" ADD CONSTRAINT "draft_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_version_id_fkey" FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preflight_runs" ADD CONSTRAINT "preflight_runs_submission_version_id_fkey" FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_journal_scopes" ADD CONSTRAINT "employee_journal_scopes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_journal_scopes" ADD CONSTRAINT "employee_journal_scopes_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewers" ADD CONSTRAINT "reviewers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "reviewers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_review_assignment_id_fkey" FOREIGN KEY ("review_assignment_id") REFERENCES "review_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_versions" ADD CONSTRAINT "translation_versions_translation_key_id_fkey" FOREIGN KEY ("translation_key_id") REFERENCES "translation_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
