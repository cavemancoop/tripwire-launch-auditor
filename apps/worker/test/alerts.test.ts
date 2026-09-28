import { describe, expect, it, vi } from 'vitest';
import { applyAlertTransitions, evaluateAlerts, runAlertLoop, type AlertCheck, type AlertReaders, type AlertStateStore } from '../src/alerts';
import type { StopSignal } from '../src/watcher/poller';
import { makeTelegramSender, TelegramSendError } from '../src/telegram/poster';

const NOW = new Date('2026-09-12T12:00:00.000Z');

function readers(overrides: Partial<AlertReaders> = {}): AlertReaders {
  return {
    latestLifecycle: async () => ({ newState: 'ACTIVE', idsMismatch: false }),
    latestPhantomEpoch: async () => false,
    latestCommitAt: async () => new Date(NOW.getTime() - 60_000),
    latestWatcherUpdate: async () => new Date(NOW.getTime() - 30_000),
    latestDetReport: async () => ({ id: 'live-a', createdAt: new Date(NOW.getTime() - 60_000), launchAt: new Date(NOW.getTime() - 12 * 60_000) }),
    ...overrides,
  };
}

describe('evaluateAlerts', () => {
  it('reports every check ok when everything is fresh and healthy', async () => {
    const checks = await evaluateAlerts({ now: NOW, readers: readers() });
    expect(checks.every((c) => !c.bad)).toBe(true);
  });

  it('flags starved from the latest lifecycle state', async () => {
    const checks = await evaluateAlerts({
      now: NOW,
      readers: readers({ latestLifecycle: async () => ({ newState: 'STARVED', idsMismatch: false }) }),
    });
    expect(checks.find((c) => c.key === 'starved')?.bad).toBe(true);
  });

  it('flags ids_trip from idsMismatch OR a phantom epoch', async () => {
    const viaMismatch = await evaluateAlerts({
      now: NOW,
      readers: readers({ latestLifecycle: async () => ({ newState: 'ACTIVE', idsMismatch: true }) }),
    });
    expect(viaMismatch.find((c) => c.key === 'ids_trip')?.bad).toBe(true);

    const viaPhantom = await evaluateAlerts({
      now: NOW,
      readers: readers({ latestPhantomEpoch: async () => true }),
    });
    expect(viaPhantom.find((c) => c.key === 'ids_trip')?.bad).toBe(true);
  });

  it('flags commit_lag past the threshold (default 10 min) but not before it', async () => {
    const justUnder = await evaluateAlerts({
      now: NOW,
      readers: readers({ latestCommitAt: async () => new Date(NOW.getTime() - 599_000) }),
    });
    expect(justUnder.find((c) => c.key === 'commit_lag')?.bad).toBe(false);

    const justOver = await evaluateAlerts({
      now: NOW,
      readers: readers({ latestCommitAt: async () => new Date(NOW.getTime() - 601_000) }),
    });
    expect(justOver.find((c) => c.key === 'commit_lag')?.bad).toBe(true);
  });

  it('flags watcher_stalled past the threshold (default 5 min)', async () => {
    const stalled = await evaluateAlerts({
      now: NOW,
      readers: readers({ latestWatcherUpdate: async () => new Date(NOW.getTime() - 301_000) }),
    });
    expect(stalled.find((c) => c.key === 'watcher_stalled')?.bad).toBe(true);
  });

  it('does not flag commit_lag or watcher_stalled when there is no row yet (fresh instance)', async () => {
    const checks = await evaluateAlerts({
      now: NOW,
      readers: readers({ latestCommitAt: async () => null, latestWatcherUpdate: async () => null }),
    });
    expect(checks.find((c) => c.key === 'commit_lag')?.bad).toBe(false);
    expect(checks.find((c) => c.key === 'watcher_stalled')?.bad).toBe(false);
  });

  it('respects custom thresholds', async () => {
    const checks = await evaluateAlerts({
      now: NOW,
      commitLagSec: 30,
      readers: readers({ latestCommitAt: async () => new Date(NOW.getTime() - 60_000) }),
    });
    expect(checks.find((c) => c.key === 'commit_lag')?.bad).toBe(true);
  });

  it('evaluates recent launch-to-report lag at the strict threshold', async () => {
    const at = (lagSec: number) => readers({
      latestDetReport: async () => ({ id: 'live-a', createdAt: NOW, launchAt: new Date(NOW.getTime() - lagSec * 1000) }),
    });
    expect((await evaluateAlerts({ now: NOW, readers: at(900) })).find((c) => c.key === 'report_lag')?.bad).toBe(false);
    expect((await evaluateAlerts({ now: NOW, readers: at(901) })).find((c) => c.key === 'report_lag')?.bad).toBe(true);
  });

  it('does not infer current report lag from missing or stale reports', async () => {
    for (const latestDetReport of [
      async () => null,
      async () => ({ id: 'no-anchor', createdAt: NOW, launchAt: null }),
      async () => ({ id: 'old', createdAt: new Date(NOW.getTime() - 21 * 60_000), launchAt: new Date(NOW.getTime() - 40 * 60_000) }),
    ]) {
      const checks = await evaluateAlerts({ now: NOW, readers: readers({ latestDetReport }) });
      expect(checks.find((c) => c.key === 'report_lag')).toBeUndefined();
    }
  });
});

const CHECK = (key: AlertCheck['key'], bad: boolean): AlertCheck => ({ key, bad, detail: bad ? 'bad' : 'ok' });

describe('applyAlertTransitions', () => {
  it('sends one message on ok->bad', async () => {
    const sent: string[] = [];
    const lastBad = new Map<AlertCheck['key'], boolean>();
    await applyAlertTransitions([CHECK('starved', true)], lastBad, async (t) => void sent.push(t));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('STARVED');
    expect(lastBad.get('starved')).toBe(true);
  });

  it('stays quiet on bad->bad (already alerted)', async () => {
    const sent: string[] = [];
    const lastBad = new Map<AlertCheck['key'], boolean>([['starved', true]]);
    await applyAlertTransitions([CHECK('starved', true)], lastBad, async (t) => void sent.push(t));
    expect(sent).toHaveLength(0);
  });

  it('sends one recovery message on bad->ok', async () => {
    const sent: string[] = [];
    const lastBad = new Map<AlertCheck['key'], boolean>([['commit_lag', true]]);
    await applyAlertTransitions([CHECK('commit_lag', false)], lastBad, async (t) => void sent.push(t));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('recovered');
    expect(lastBad.get('commit_lag')).toBe(false);
  });

  it('retries a failed recovery send without changing the remembered bad state', async () => {
    const lastBad = new Map<AlertCheck['key'], boolean>([['commit_lag', true]]);
    await applyAlertTransitions([CHECK('commit_lag', false)], lastBad, async () => { throw new Error('telegram down'); });
    expect(lastBad.get('commit_lag')).toBe(true);
    const sent: string[] = [];
    await applyAlertTransitions([CHECK('commit_lag', false)], lastBad, async (text) => void sent.push(text));
    expect(sent).toHaveLength(1);
    expect(lastBad.get('commit_lag')).toBe(false);
  });

  it('stays quiet on ok->ok', async () => {
    const sent: string[] = [];
    const lastBad = new Map<AlertCheck['key'], boolean>([['watcher_stalled', false]]);
    await applyAlertTransitions([CHECK('watcher_stalled', false)], lastBad, async (t) => void sent.push(t));
    expect(sent).toHaveLength(0);
  });

  it('backs off a permanent Telegram rejection instead of logging every tick', async () => {
    const lastBad = new Map<AlertCheck['key'], boolean>();
    const retryUntil = new Map<AlertCheck['key'], number>();
    let now = 1_000;
    let attempts = 0;
    const send = async () => { attempts++; throw new TelegramSendError(403, 'forbidden'); };
    await applyAlertTransitions([CHECK('ids_trip', true)], lastBad, send, undefined, retryUntil, () => now);
    await applyAlertTransitions([CHECK('ids_trip', true)], lastBad, send, undefined, retryUntil, () => now);
    expect(attempts).toBe(1);
    now += 10 * 60_000;
    await applyAlertTransitions([CHECK('ids_trip', true)], lastBad, send, undefined, retryUntil, () => now);
    expect(attempts).toBe(2);
    expect(lastBad.get('ids_trip')).toBeUndefined();
  });

  it('retries a failed send on the next tick', async () => {
    const lastBad = new Map<AlertCheck['key'], boolean>();
    await applyAlertTransitions([CHECK('ids_trip', true)], lastBad, async () => {
      throw new Error('telegram down');
    });
    expect(lastBad.get('ids_trip')).toBeUndefined();
    const sent: string[] = [];
    await applyAlertTransitions([CHECK('ids_trip', true)], lastBad, async (text) => void sent.push(text));
    expect(sent).toHaveLength(1);
    expect(lastBad.get('ids_trip')).toBe(true);
  });
});

const inMemoryState = (): AlertStateStore => {
  const rows = new Map<AlertCheck['key'], boolean>();
  return {
    load: async () => new Map(rows),
    save: async (key, bad) => { rows.set(key, bad); },
  };
};

describe('runAlertLoop', () => {
  it('keeps provider windows separate when a database-backed evaluation fails', async () => {
    const snapshots = [
      { attempts: 0, providerFailures: 0, quotaFailures: 0 },
      { attempts: 60, providerFailures: 6, quotaFailures: 0 },
      { attempts: 120, providerFailures: 6, quotaFailures: 0 },
    ];
    const signal: StopSignal = { stopped: false };
    const sent: string[] = [];
    let tick = 0;
    let sampleTick = 0;
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state: inMemoryState(),
      evaluate: async () => {
        tick++;
        if (tick === snapshots.length) signal.stopped = true;
        if (tick === 2) throw new Error('db query failed');
        return [];
      },
      readProviderStats: () => snapshots[sampleTick++]!, // read before evaluate
      send: async (message) => void sent.push(message),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('6/60');
  });

  it('delivers a short provider incident after Telegram recovers, then sends recovery', async () => {
    const snapshots = [
      { attempts: 100, providerFailures: 10, quotaFailures: 0 },
      { attempts: 200, providerFailures: 10, quotaFailures: 0 },
      { attempts: 300, providerFailures: 10, quotaFailures: 0 },
      { attempts: 400, providerFailures: 10, quotaFailures: 0 },
    ];
    const signal: StopSignal = { stopped: false };
    const sent: string[] = [];
    let tick = 0;
    let sampleTick = 0;
    let sends = 0;
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state: inMemoryState(),
      evaluate: async () => { if (++tick === snapshots.length) signal.stopped = true; return []; },
      readProviderStats: () => snapshots[sampleTick++]!,
      send: async (message) => {
        if (++sends < 3) throw new Error('telegram down');
        sent.push(message);
      },
    });
    expect(sends).toBe(4);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('RPC provider failures');
    expect(sent[1]).toContain('recovered');
  });

  it('retries a quota alert after a failed send and recovers only after two windows of healthy traffic', async () => {
    const snapshots = [
      { attempts: 0, providerFailures: 0, quotaFailures: 0 },
      { attempts: 100, providerFailures: 1, quotaFailures: 1 },
      { attempts: 100, providerFailures: 1, quotaFailures: 1 },
      { attempts: 200, providerFailures: 1, quotaFailures: 1 },
      { attempts: 300, providerFailures: 1, quotaFailures: 1 },
    ];
    const signal: StopSignal = { stopped: false };
    const sent: string[] = [];
    let tick = 0;
    let sampleTick = 0;
    let sends = 0;
    const state = inMemoryState();
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state,
      evaluate: async () => { if (++tick === snapshots.length) signal.stopped = true; return []; },
      readProviderStats: () => snapshots[sampleTick++]!,
      send: async (message) => {
        if (++sends === 1) throw new Error('telegram down');
        sent.push(message);
      },
    });
    expect(sends).toBe(3); // failed alarm, retried alarm, recovery
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('RPC provider failures');
    expect(sent[1]).toContain('recovered');
    expect((await state.load()).get('provider_failure')).toBe(false);
  });

  it('retains a delivered provider alarm across restart and no traffic', async () => {
    const state = inMemoryState();
    const sent: string[] = [];
    const run = async (snapshots: Array<{ attempts: number; providerFailures: number; quotaFailures: number }>) => {
      const signal: StopSignal = { stopped: false };
      let tick = 0;
      let sampleTick = 0;
      await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
        state,
        evaluate: async () => { if (++tick === snapshots.length) signal.stopped = true; return []; },
        readProviderStats: () => snapshots[sampleTick++]!,
        send: async (message) => void sent.push(message),
      });
    };
    await run([{ attempts: 100, providerFailures: 10, quotaFailures: 0 }]);
    expect((await state.load()).get('provider_failure')).toBe(true);
    await run([{ attempts: 0, providerFailures: 0, quotaFailures: 0 }]);
    expect(sent).toHaveLength(1);
    expect((await state.load()).get('provider_failure')).toBe(true);
    await run([
      { attempts: 100, providerFailures: 0, quotaFailures: 0 },
      { attempts: 200, providerFailures: 0, quotaFailures: 0 },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('recovered');
  });

  it('counts two distinct late reports, not repeated reads of one report, and recovers on a fresh on-time report', async () => {
    const sent: string[] = [];
    const sentAt: number[] = [];
    const signal: StopSignal = { stopped: false };
    const samples = [
      { id: 'late-a', bad: true },
      { id: 'late-a', bad: true },
      { id: 'late-b', bad: true },
      { id: 'on-time-c', bad: false },
    ];
    let tick = 0;
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state: inMemoryState(),
      evaluate: async () => {
        const sample = samples[tick++]!;
        if (tick === samples.length) signal.stopped = true;
        return [{ ...CHECK('report_lag', sample.bad), sampleId: sample.id }];
      },
      send: async (message) => { sent.push(message); sentAt.push(tick); },
    });
    expect(sent).toHaveLength(2);
    expect(sentAt).toEqual([3, 4]);
    expect(sent[0]).toContain('deterministic report lag');
    expect(sent[1]).toContain('recovered');
  });

  it('does not recover an alerted lag from an absent sample', async () => {
    const sent: string[] = [];
    const state = inMemoryState();
    await state.save('report_lag', true);
    const signal: StopSignal = { stopped: false };
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state,
      evaluate: async () => { signal.stopped = true; return []; },
      send: async (message) => void sent.push(message),
    });
    expect(sent).toHaveLength(0);
    expect((await state.load()).get('report_lag')).toBe(true);
  });

  it('over three ticks: alerts once on the first bad tick, stays quiet on the second, and sends a recovery on the third', async () => {
    const sent: string[] = [];
    const ticks: AlertCheck[][] = [
      [CHECK('starved', true)],
      [CHECK('starved', true)],
      [CHECK('starved', false)],
    ];
    let i = 0;
    const signal: StopSignal = { stopped: false };

    await runAlertLoop(
      signal,
      { botToken: 'tkn', chatId: 'chat', intervalMs: 1 },
      {
        evaluate: async () => {
          const checks = ticks[i]!;
          i += 1;
          if (i >= ticks.length) signal.stopped = true;
          return checks;
        },
        send: async (t) => void sent.push(t),
        state: inMemoryState(),
      },
    );

    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('STARVED');
    expect(sent[1]).toContain('recovered');
  });

  it('loads a prior alert after restart and sends only the recovery', async () => {
    const state = inMemoryState();
    const sent: string[] = [];
    const runOnce = async (bad: boolean) => {
      const signal: StopSignal = { stopped: false };
      await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
        state,
        evaluate: async () => { signal.stopped = true; return [CHECK('starved', bad)]; },
        send: async (text) => void sent.push(text),
      });
    };
    await runOnce(true);
    await runOnce(true);
    await runOnce(false);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('STARVED');
    expect(sent[1]).toContain('recovered');
  });

  it('waits for persisted state when the initial read fails', async () => {
    let loads = 0;
    const state: AlertStateStore = {
      load: async () => {
        if (++loads === 1) throw new Error('db unavailable');
        return new Map([['starved', true]]);
      },
      save: async () => {},
    };
    const sent: string[] = [];
    const signal: StopSignal = { stopped: false };
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state,
      evaluate: async () => { signal.stopped = true; return [CHECK('starved', true)]; },
      send: async (text) => void sent.push(text),
    });
    expect(loads).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it('flushes a failed state write on graceful stop', async () => {
    const rows = new Map<AlertCheck['key'], boolean>();
    let saves = 0;
    const state: AlertStateStore = {
      load: async () => new Map(rows),
      save: async (key, bad) => {
        if (++saves === 1) throw new Error('db unavailable');
        rows.set(key, bad);
      },
    };
    const signal: StopSignal = { stopped: false };
    const sent: string[] = [];
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state,
      evaluate: async () => { signal.stopped = true; return [CHECK('ids_trip', true)]; },
      send: async (text) => void sent.push(text),
    });
    expect(sent).toHaveLength(1);
    expect(saves).toBe(2);
    expect(rows.get('ids_trip')).toBe(true);
  });

  it('retries a failed state write without repeating a sent alert', async () => {
    const rows = new Map<AlertCheck['key'], boolean>();
    let failOnce = true;
    const state: AlertStateStore = {
      load: async () => new Map(rows),
      save: async (key, bad) => {
        if (failOnce) { failOnce = false; throw new Error('db unavailable'); }
        rows.set(key, bad);
      },
    };
    const sent: string[] = [];
    const signal: StopSignal = { stopped: false };
    let tick = 0;
    await runAlertLoop(signal, { botToken: 'tkn', chatId: 'chat', intervalMs: 1 }, {
      state,
      evaluate: async () => { if (++tick === 2) signal.stopped = true; return [CHECK('ids_trip', true)]; },
      send: async (text) => void sent.push(text),
    });
    expect(sent).toHaveLength(1);
    expect(rows.get('ids_trip')).toBe(true);
  });
});

describe('operational Telegram transport', () => {
  it('aborts a hanging alert send within its deadline', async () => {
    const hangingFetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    vi.stubGlobal('fetch', hangingFetch);
    try {
      await expect(makeTelegramSender('bot', 'chat', 5)('alert')).rejects.toThrow();
      expect(hangingFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
