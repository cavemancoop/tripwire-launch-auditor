import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

function enumValues(name: string): string[] {
  const m = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!m) throw new Error(`enum ${name} not found`);
  return m[1]!
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
}

describe('prisma schema', () => {
  it('defines the four mechanical outcomes from spec §1', () => {
    expect(enumValues('OutcomeLabel').sort()).toEqual(
      ['DRAWDOWN_80', 'INSIDER_EXIT', 'LIQ_IMPAIRED', 'SELL_IMPAIRED'].sort(),
    );
  });

  it('defines the forecasters scored side by side in spec §2', () => {
    const kinds = enumValues('ForecasterKind');
    for (const k of ['base_rate', 'heuristic_v1', 'det_v0', 'llm_deepdive_v0', 'scanhood', 'goplus']) {
      expect(kinds).toContain(k);
    }
  });

  it('maps the seven build-guide tables', () => {
    for (const table of [
      'launches',
      'features',
      'reports',
      'commits',
      'outcomes',
      'lifecycle_log',
      'receipts',
    ]) {
      expect(schema).toContain(`@@map("${table}")`);
    }
  });

  it('carries the Metabolism state machine (spec §8)', () => {
    expect(enumValues('LifecycleState').sort()).toEqual(
      ['ACTIVE', 'DRAINING', 'NO_KEY', 'REVOKING', 'ROTATING', 'STARVED'].sort(),
    );
  });

  it('keeps verbatim external-scanner blobs with fetch timestamps (spec §3.3)', () => {
    expect(schema).toMatch(/goplusRaw\s+Json\?/);
    expect(schema).toMatch(/goplusFetchedAt\s+DateTime\?/);
    expect(schema).toMatch(/scanhoodRaw\s+Json\?/);
    expect(schema).toMatch(/scanhoodFetchedAt\s+DateTime\?/);
  });
});
