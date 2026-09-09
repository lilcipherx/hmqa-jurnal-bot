CREATE TYPE "DecisionType" AS ENUM ('ACCEPT', 'REJECT');
CREATE TYPE "DecisionProposalStatus" AS ENUM ('PREPARED', 'APPROVED', 'CANCELLED');

CREATE TABLE "decision_proposals" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "decision" "DecisionType" NOT NULL,
  "public_reason" TEXT NOT NULL,
  "internal_basis" TEXT NOT NULL,
  "status" "DecisionProposalStatus" NOT NULL DEFAULT 'PREPARED',
  "prepared_by_id" UUID NOT NULL,
  "approved_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  CONSTRAINT "decision_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_proposals_submission_id_status_created_at_idx"
ON "decision_proposals"("submission_id", "status", "created_at");
CREATE INDEX "decision_proposals_prepared_by_id_created_at_idx"
ON "decision_proposals"("prepared_by_id", "created_at");

ALTER TABLE "decision_proposals" ADD CONSTRAINT "decision_proposals_submission_id_fkey"
FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_proposals" ADD CONSTRAINT "decision_proposals_prepared_by_id_fkey"
FOREIGN KEY ("prepared_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_proposals" ADD CONSTRAINT "decision_proposals_approved_by_id_fkey"
FOREIGN KEY ("approved_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_assignments"
ADD CONSTRAINT "review_assignments_anonymized_file_id_fkey"
FOREIGN KEY ("anonymized_file_id") REFERENCES "file_assets"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
