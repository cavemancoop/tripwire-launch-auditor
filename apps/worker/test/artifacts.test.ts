import { keccak256, size, stringToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_KIND, computeArtifactHashes } from '../src/commit/artifacts';

describe('artifact hashes', () => {
  it('kinds are keccak256 of their labels', () => {
    expect(ARTIFACT_KIND.weights).toBe(keccak256(stringToHex('weights')));
    expect(ARTIFACT_KIND.featureCode).toBe(keccak256(stringToHex('feature_code')));
    expect(ARTIFACT_KIND.outcomeRule).toBe(keccak256(stringToHex('outcome_rule')));
  });

  it('computes three distinct 32-byte hashes, deterministically', () => {
    const a = computeArtifactHashes();
    const b = computeArtifactHashes();
    for (const h of [a.weights, a.featureCode, a.outcomeRule]) {
      expect(size(h)).toBe(32);
    }
    expect(new Set([a.weights, a.featureCode, a.outcomeRule]).size).toBe(3);
    expect(a).toEqual(b);
  });
});
