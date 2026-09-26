import { describe, expect, it } from 'vitest';
import { parseOutcomesEnabled } from '../src/env';

describe('OUTCOMES_ENABLED cutover setting', () => {
  it('preserves the existing resolver behavior when unset', () => {
    expect(parseOutcomesEnabled(undefined)).toBe(true);
  });

  it('accepts an explicit pause and restart', () => {
    expect(parseOutcomesEnabled('0')).toBe(false);
    expect(parseOutcomesEnabled(' false ')).toBe(false);
    expect(parseOutcomesEnabled('1')).toBe(true);
    expect(parseOutcomesEnabled('TRUE')).toBe(true);
  });

  it('refuses ambiguous values during a planned writer cutover', () => {
    expect(() => parseOutcomesEnabled('off')).toThrow(/OUTCOMES_ENABLED/);
    expect(() => parseOutcomesEnabled('')).toThrow(/OUTCOMES_ENABLED/);
  });
});
