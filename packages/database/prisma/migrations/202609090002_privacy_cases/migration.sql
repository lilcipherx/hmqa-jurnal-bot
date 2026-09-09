CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION');
CREATE TYPE "DataSubjectRequestStatus" AS ENUM (
    'RECEIVED',
    'IDENTITY_VERIFICATION',
    'IN_REVIEW',
    'APPROVED',
    'DENIED',
    'EXECUTING',
    'COMPLETED',
    'CANCELLED'
);
CREATE TYPE "LegalHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "public_id" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "locale" "Locale" NOT NULL,
    "request_note" TEXT,
    "assigned_to_id" UUID,
    "identity_verified_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "decision_reason" TEXT,
    "execution_report" JSONB,
    "completed_at" TIMESTAMPTZ(6),
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_subject_requests_public_id_key"
    ON "data_subject_requests"("public_id");
CREATE INDEX "data_subject_requests_user_id_status_created_at_idx"
    ON "data_subject_requests"("user_id", "status", "created_at");
CREATE INDEX "data_subject_requests_status_due_at_idx"
    ON "data_subject_requests"("status", "due_at");
CREATE INDEX "data_subject_requests_assigned_to_id_status_idx"
    ON "data_subject_requests"("assigned_to_id", "status");

CREATE TABLE "legal_holds" (
    "id" UUID NOT NULL,
    "status" "LegalHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "subject_user_id" UUID,
    "submission_id" UUID,
    "data_subject_request_id" UUID,
    "reason" TEXT NOT NULL,
    "placed_by_id" UUID NOT NULL,
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ(6),
    "release_reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_holds_has_subject_check"
        CHECK ("subject_user_id" IS NOT NULL OR "submission_id" IS NOT NULL),
    CONSTRAINT "legal_holds_release_consistency_check"
        CHECK (
            ("status" = 'ACTIVE' AND "released_at" IS NULL AND "released_by_id" IS NULL)
            OR
            ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "released_by_id" IS NOT NULL)
        )
);

CREATE INDEX "legal_holds_subject_user_id_status_idx"
    ON "legal_holds"("subject_user_id", "status");
CREATE INDEX "legal_holds_submission_id_status_idx"
    ON "legal_holds"("submission_id", "status");
CREATE INDEX "legal_holds_data_subject_request_id_status_idx"
    ON "legal_holds"("data_subject_request_id", "status");
CREATE INDEX "legal_holds_status_expires_at_idx"
    ON "legal_holds"("status", "expires_at");
CREATE UNIQUE INDEX "legal_holds_active_user_key"
    ON "legal_holds"("subject_user_id")
    WHERE "status" = 'ACTIVE' AND "submission_id" IS NULL;
CREATE UNIQUE INDEX "legal_holds_active_submission_key"
    ON "legal_holds"("submission_id")
    WHERE "status" = 'ACTIVE';

ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
    ADD CONSTRAINT "data_subject_requests_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
    ADD CONSTRAINT "legal_holds_subject_user_id_fkey"
    FOREIGN KEY ("subject_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
    ADD CONSTRAINT "legal_holds_submission_id_fkey"
    FOREIGN KEY ("submission_id") REFERENCES "submissions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
    ADD CONSTRAINT "legal_holds_data_subject_request_id_fkey"
    FOREIGN KEY ("data_subject_request_id") REFERENCES "data_subject_requests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
    ADD CONSTRAINT "legal_holds_placed_by_id_fkey"
    FOREIGN KEY ("placed_by_id") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
    ADD CONSTRAINT "legal_holds_released_by_id_fkey"
    FOREIGN KEY ("released_by_id") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
