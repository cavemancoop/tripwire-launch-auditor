-- Additive diagnostic provenance. Existing signed reports remain untouched.
ALTER TABLE "reports" ADD COLUMN "laneAtFirstStore" "Lane";
