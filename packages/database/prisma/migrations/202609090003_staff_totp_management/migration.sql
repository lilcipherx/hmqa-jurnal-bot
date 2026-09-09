ALTER TABLE "employees"
ADD COLUMN "totp_reset_required_at" TIMESTAMPTZ(6);

CREATE TABLE "staff_totp_enrollments" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "secret_cipher" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_totp_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_totp_enrollments_token_hash_key"
ON "staff_totp_enrollments"("token_hash");

CREATE INDEX "staff_totp_enrollments_employee_id_completed_at_revoked_at_expires_at_idx"
ON "staff_totp_enrollments"("employee_id", "completed_at", "revoked_at", "expires_at");

ALTER TABLE "staff_totp_enrollments"
ADD CONSTRAINT "staff_totp_enrollments_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
