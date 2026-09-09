CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "submission_receipts" (
    "id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "file_id" UUID,
    "template_version" VARCHAR(100) NOT NULL,
    "data_snapshot" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(150),
    "ready_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submission_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submission_receipts_file_id_key" ON "submission_receipts"("file_id");
CREATE UNIQUE INDEX "submission_receipts_submission_version_id_locale_key"
    ON "submission_receipts"("submission_version_id", "locale");
CREATE INDEX "submission_receipts_status_updated_at_idx"
    ON "submission_receipts"("status", "updated_at");

ALTER TABLE "submission_receipts"
    ADD CONSTRAINT "submission_receipts_submission_version_id_fkey"
    FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "submission_receipts"
    ADD CONSTRAINT "submission_receipts_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "file_assets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
