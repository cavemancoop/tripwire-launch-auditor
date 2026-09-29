import { describe, expect, it } from 'vitest';
import { buildTrailingBaseRate, type TimedOutcome } from '../src/scorer/trailing-base-rate';

const DAY = 24 * 3600 * 1000;

describe('rolling base-rate semantics', () => {
  it('excludes same-time labels, includes the exact 30-day boundary, and falls back to all earlier rows', () => {
    const rate = buildTrailingBaseRate({
      cell: [
        { t: 30 * DAY, y: false },
        { t: 0, y: true },
        { t: 60 * DAY, y: true },
        { t: 30 * DAY, y: true },
        { t: 1, y: false },
      ],
    });
    expect(rate('cell', 0)).toBe(0);
    expect(rate('cell', 1)).toBe(1);
    expect(rate('cell', 30 * DAY)).toBe(0.5); // two same-time rows excluded
    expect(rate('cell', 30 * DAY + 1)).toBe(1 / 3);
    expect(rate('cell', 60 * DAY)).toBe(0.5); // 30-day-old rows included
    expect(rate('cell', 91 * DAY)).toBe(3 / 5); // empty window: all five earlier
    expect(rate('missing', 91 * DAY)).toBe(0);
  });

  it('matches the prior scan rule across mixed anchor order, ties and gaps', () => {
    const rows: TimedOutcome[] = [];
    for (let i = 0; i < 300; i++) {
      rows.push({ t: Math.floor((i * 37) % 190) * DAY, y: i % 7 < 2 });
    }
    const rate = buildTrailingBaseRate({ cell: rows });
    const oldRate = (at: number): number => {
      const prior = rows.filter((r) => r.t < at);
      const window = prior.filter((r) => r.t >= at - 30 * DAY);
      const selected = window.length ? window : prior;
      return selected.length ? selected.filter((r) => r.y).length / selected.length : 0;
    };
    for (let day = -1; day <= 220; day++) {
      expect(rate('cell', day * DAY)).toBe(oldRate(day * DAY));
    }
  });
});
