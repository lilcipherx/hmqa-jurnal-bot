ALTER TABLE "submissions"
ADD COLUMN "response_deadline" TIMESTAMPTZ(6),
ADD COLUMN "publication_reference" TEXT;

CREATE INDEX "submissions_status_response_deadline_idx"
ON "submissions"("status", "response_deadline");
