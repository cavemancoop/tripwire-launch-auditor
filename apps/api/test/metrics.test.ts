import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { formatPrometheus, type MetricsSnapshot } from '../src/metrics';

const SNAPSHOT: MetricsSnapshot = {
  watcherStalenessSec: 12.3,
  commitAgeSec: 45.6,
  metabolismState: 'ACTIVE',
  idsOrPhantomFlagged: false,
  launches24h: 7,
  reports24h: 3,
};

describe('formatPrometheus', () => {
  it('emits HELP/TYPE/value lines for every gauge', () => {
    const text = formatPrometheus(SNAPSHOT);
    expect(text).toContain('launch_auditor_watcher_staleness_seconds 12.3');
    expect(text).toContain('launch_auditor_commit_age_seconds 45.6');
    expect(text).toContain('launch_auditor_ids_or_phantom_flagged 0');
    expect(text).toContain('launch_auditor_launches_24h 7');
    expect(text).toContain('launch_auditor_reports_24h 3');
    expect(text).toMatch(/^# HELP /m);
    expect(text).toMatch(/^# TYPE /m);
  });

  it('emits one metabolism_state series per known state, only the current one at 1', () => {
    const text = formatPrometheus(SNAPSHOT);
    expect(text).toContain('launch_auditor_metabolism_state{state="ACTIVE"} 1');
    expect(text).toContain('launch_auditor_metabolism_state{state="STARVED"} 0');
    expect(text).toContain('launch_auditor_metabolism_state{state="NO_KEY"} 0');
  });

  it('renders NaN, never 0, for a null (unavailable) gauge', () => {
    const text = formatPrometheus({ ...SNAPSHOT, watcherStalenessSec: null, commitAgeSec: null });
    expect(text).toContain('launch_auditor_watcher_staleness_seconds NaN');
    expect(text).toContain('launch_auditor_commit_age_seconds NaN');
  });

  it('emits per-label outcome backlog series only when provided', () => {
    expect(formatPrometheus(SNAPSHOT)).not.toContain('launch_auditor_outcomes_pending_due');
    const text = formatPrometheus({
      ...SNAPSHOT,
      outcomes: [{ label: 'SELL_IMPAIRED', pendingDue: 900, deferred: 850, resolved24h: 3 }],
    });
    expect(text).toContain('launch_auditor_outcomes_pending_due{label="SELL_IMPAIRED"} 900');
    expect(text).toContain('launch_auditor_outcomes_deferred{label="SELL_IMPAIRED"} 850');
    expect(text).toContain('launch_auditor_outcomes_resolved_24h{label="SELL_IMPAIRED"} 3');
  });

  it('flags ids_or_phantom as 1 when set', () => {
    const text = formatPrometheus({ ...SNAPSHOT, idsOrPhantomFlagged: true });
    expect(text).toContain('launch_auditor_ids_or_phantom_flagged 1');
  });
});

describe('GET /metrics', () => {
  it('serves the Prometheus text exposition with the right content type', async () => {
    const app = buildServer({ metricsReader: async () => SNAPSHOT });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toContain('launch_auditor_metabolism_state{state="ACTIVE"} 1');
    await app.close();
  });
});
