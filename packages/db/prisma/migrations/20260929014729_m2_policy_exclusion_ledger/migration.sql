-- CreateTable
CREATE TABLE "policy_exclusion_runs" (
    "id" TEXT NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "backupSha256" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_exclusion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_exclusion_candidates" (
    "runId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "label" "OutcomeLabel" NOT NULL,
    "originalValue" BOOLEAN,
    "originalEvidence" JSONB,
    "originalMeasuredAt" TIMESTAMP(3),
    "originalUpdatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "skipReason" TEXT,
    "revertedAt" TIMESTAMP(3),
    "revertSkippedAt" TIMESTAMP(3),
    "revertSkipReason" TEXT,

    CONSTRAINT "policy_exclusion_candidates_pkey" PRIMARY KEY ("runId","outcomeId")
);

-- CreateIndex
CREATE INDEX "policy_exclusion_candidates_runId_appliedAt_skippedAt_outco_idx" ON "policy_exclusion_candidates"("runId", "appliedAt", "skippedAt", "outcomeId");

-- AddForeignKey
ALTER TABLE "policy_exclusion_candidates" ADD CONSTRAINT "policy_exclusion_candidates_runId_fkey" FOREIGN KEY ("runId") REFERENCES "policy_exclusion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
