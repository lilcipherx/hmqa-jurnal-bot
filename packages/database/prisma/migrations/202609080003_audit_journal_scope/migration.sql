ALTER TABLE "audit_logs" ADD COLUMN "journal_id" UUID;

CREATE INDEX "audit_logs_journal_id_created_at_idx"
ON "audit_logs"("journal_id", "created_at");

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_journal_id_fkey"
FOREIGN KEY ("journal_id") REFERENCES "journals"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
