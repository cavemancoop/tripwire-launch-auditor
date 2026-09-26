-- Additive M2 schema staging. No existing outcome row is changed by this migration.
ALTER TYPE "OutcomeStatus" ADD VALUE 'POLICY_EXCLUDED';
