CREATE TABLE "staff_invitations" (
  "id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");
CREATE INDEX "staff_invitations_employee_id_expires_at_accepted_at_idx"
ON "staff_invitations"("employee_id", "expires_at", "accepted_at");

ALTER TABLE "staff_invitations"
ADD CONSTRAINT "staff_invitations_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
