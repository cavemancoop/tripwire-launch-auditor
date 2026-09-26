import { describe, expect, it } from 'vitest';
import { UNCONFIRMED_MAX_AGE_MS, prioritizeCommitReports, unconfirmedAction } from '../src/commit/job';

// 2026-09-15: receipts missed the 240s deadline for txs that had mined, and the
// batch was re-committed. A sent tx is now resolved before any new batch goes out.
describe('unconfirmedAction', () => {
  const sentAt = 1_000_000;

  it('late success receipt → record that batch, do not re-commit', () => {
    expect(unconfirmedAction({ sentAt }, { status: 'success' }, sentAt + 400_000)).toBe('finalize');
  });

  it('reverted → drop, its reports re-commit', () => {
    expect(unconfirmedAction({ sentAt }, { status: 'reverted' }, sentAt + 1)).toBe('drop_reverted');
  });

  it('still no receipt → wait, send nothing', () => {
    expect(unconfirmedAction({ sentAt }, null, sentAt + UNCONFIRMED_MAX_AGE_MS - 1)).toBe('wait');
  });

  it('no receipt after the max age → drop', () => {
    expect(unconfirmedAction({ sentAt }, null, sentAt + UNCONFIRMED_MAX_AGE_MS)).toBe('drop_expired');
  });
});

describe('commit ordering under an assessment burst', () => {
  it('fills a batch with launch and qualified reports before older on-demand leaves', () => {
    const pending = [
      { id: 'old-assess-1', trigger: 'on_demand' },
      { id: 'old-assess-2', trigger: 'on_demand' },
      { id: 'live-launch-1', trigger: 'launch' },
      { id: 'event', trigger: 'event' },
      { id: 'live-qualified', trigger: 'qualified' },
      { id: 'live-launch-2', trigger: 'launch' },
    ];
    expect(prioritizeCommitReports(pending).slice(0, 3).map((r) => r.id)).toEqual([
      'live-launch-1', 'live-qualified', 'live-launch-2',
    ]);
    expect(prioritizeCommitReports(pending).map((r) => r.id)).toEqual([
      'live-launch-1', 'live-qualified', 'live-launch-2', 'event', 'old-assess-1', 'old-assess-2',
    ]);
    expect(pending[0]?.id).toBe('old-assess-1'); // leave the database-order input intact
  });
});
