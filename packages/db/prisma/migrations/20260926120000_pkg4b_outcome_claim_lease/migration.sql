-- Package 4b (review d17cd0c4): expiring per-attempt ownership of an outcome row.
-- Both columns are NULL on every existing row, which reads as unclaimed.
-- AlterTable
ALTER TABLE "outcomes" ADD COLUMN     "claimToken" TEXT,
ADD COLUMN     "claimExpiresAt" TIMESTAMP(3);
