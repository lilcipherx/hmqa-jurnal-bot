CREATE TABLE "draft_preflight_runs" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
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
    CONSTRAINT "draft_preflight_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "draft_preflight_runs_draft_id_file_id_key"
    ON "draft_preflight_runs"("draft_id", "file_id");
CREATE INDEX "draft_preflight_runs_status_created_at_idx"
    ON "draft_preflight_runs"("status", "created_at");
ALTER TABLE "draft_preflight_runs"
    ADD CONSTRAINT "draft_preflight_runs_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draft_preflight_runs"
    ADD CONSTRAINT "draft_preflight_runs_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
