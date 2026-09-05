import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex, toHex, type Hex } from 'viem';

// Frozen-artifact hashes committed once on first run (spec §6). Guide M3:
// weights file, feature code, and outcome-rule text.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..'); // apps/worker/src/commit -> repo root

/** kind bytes32 = keccak256(label) */
export const ARTIFACT_KIND = {
  weights: keccak256(stringToHex('weights')),
  featureCode: keccak256(stringToHex('feature_code')),
  outcomeRule: keccak256(stringToHex('outcome_rule')),
} as const;

/** files whose bytes define the deterministic feature vector (spec "feature code is public") */
const FEATURE_CODE_FILES = [
  'apps/worker/src/watcher/features.ts',
  'apps/worker/src/watcher/cluster.ts',
  'apps/worker/src/watcher/creator.ts',
  'apps/worker/src/watcher/holders.ts',
  'apps/worker/src/watcher/feature9.ts',
  'apps/worker/src/watcher/sellimpact.ts',
  'apps/worker/src/watcher/classify.ts',
  'apps/worker/src/watcher/erc20.ts',
  'apps/worker/src/scanners/goplus.ts',
  'apps/worker/src/scanners/scanhood.ts',
  'packages/chain/src/uniswap.ts',
  'packages/scoring/src/inputs.ts',
  'packages/scoring/src/det.ts',
  'packages/scoring/src/heuristic.ts',
];

function hashFile(rel: string): Hex {
  return keccak256(toHex(readFileSync(join(repoRoot, rel))));
}

/** keccak256 of a sorted manifest "<sha> <path>\n" — order-stable, tamper-evident */
function hashFileSet(files: string[]): Hex {
  const manifest = [...files]
    .sort()
    .map((f) => `${hashFile(f)}  ${f}`)
    .join('\n');
  return keccak256(stringToHex(manifest));
}

export interface ArtifactHashes {
  weights: Hex;
  featureCode: Hex;
  outcomeRule: Hex;
}

export function computeArtifactHashes(): ArtifactHashes {
  return {
    weights: hashFile('packages/scoring/weights/det_v0.json'),
    featureCode: hashFileSet(FEATURE_CODE_FILES),
    outcomeRule: hashFile('packages/scoring/OUTCOME_RULES_v1.md'),
  };
}
