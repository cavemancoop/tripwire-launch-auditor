import { describe, expect, it } from 'vitest';
import { sweepDisposition } from '../src/outcomes/loop';
import { DeadlineError } from '../src/watcher/retry';
import { QUOTA_18_SEP, named, viemRpcError } from './fixtures/outcome-quota';

// Package 4a / review 896555be: the sweep's retry decision reads the shared RPC
// taxonomy instead of its own pattern. The pattern it replaced, verbatim, is the
// compatibility oracle: nothing it retried may become a code-path failure or a
// terminal UNRESOLVABLE write.
const LEGACY_RETRYABLE =
  /network|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|429|rate.?limit|too many requests|request limit|network is busy|-32005|-32097|capacity|throttl|sweep error/i;

/** one text per legacy alternative, plus the resolver reasons that carried them */
const LEGACY_RETRIED = [
  'network error',
  'Network request failed',
  'timeout exceeded',
  'connect ETIMEDOUT 10.0.0.1:443',
  'read ECONNRESET',
  'connect ECONNREFUSED 10.0.0.1:443',
  'socket hang up',
  'fetch failed',
  'HTTP 429',
  'rate limit exceeded',
  'ratelimit hit',
  'Too Many Requests',
  'daily request limit reached',
  'network is busy, try again in a moment',
  'error -32005',
  'error -32097',
  'over capacity',
  'request throttled',
  '[outcomes] sweep error',
  'quoter network at horizon block',
  'spot sell quote network at horizon block',
  '100-unit sell quote network at horizon block',
  'could not scan the survival window: timeout',
];

describe('sweepDisposition — every text the old sweep pattern retried still defers', () => {
  it.each(LEGACY_RETRIED)('%s', (text) => {
    expect(LEGACY_RETRYABLE.test(text)).toBe(true);
    expect(sweepDisposition(new Error(text))).toBe('defer'); // thrown
    expect(sweepDisposition(text)).toBe('defer'); // resolver reason
  });

  it('a provider failure beside an archive miss still defers', () => {
    expect(sweepDisposition(new Error('header not found; request timeout'))).toBe('defer');
    expect(sweepDisposition(named('Error', 'missing trie node', { cause: new Error('socket hang up') }))).toBe('defer');
  });
});

describe('sweepDisposition — provider failures the old pattern missed now defer', () => {
  const cases: Array<[string, unknown]> = [
    ['request timed out in viem details', viemRpcError('request timed out')],
    ['a nested transport cause', named('CallExecutionError', 'Execution failed.', { cause: viemRpcError('socket hang up') })],
    ['viem TimeoutError by name', named('TimeoutError', 'The request took too long to respond.')],
    ['DNS failure', new Error('getaddrinfo EAI_AGAIN rpc.example')],
    ['the outcome deadline', new DeadlineError(120_000, 'TRADING_ALIVE@24h 0xabc')],
  ];
  it.each(cases)('%s', (_name, err) => {
    expect(sweepDisposition(err)).toBe('defer');
  });

  it('the old pattern really did miss them (message text only)', () => {
    expect(LEGACY_RETRYABLE.test(viemRpcError('request timed out').message)).toBe(false);
    expect(LEGACY_RETRYABLE.test('Execution failed.')).toBe(false);
  });
});

describe('sweepDisposition — quota pauses the clock wherever it appears', () => {
  const cases: Array<[string, unknown]> = [
    ['exact 18 Sep text', new Error(QUOTA_18_SEP)],
    ['in viem details', viemRpcError(QUOTA_18_SEP)],
    ['as HTTP 429', new Error(`HTTP request failed.\n\nStatus: 429\nDetails: ${QUOTA_18_SEP}`)],
    ['two causes deep', named('CallExecutionError', 'Execution failed.', { cause: named('Wrap', 'wrapped', { cause: viemRpcError(QUOTA_18_SEP) }) })],
    ['as a resolver reason', `could not scan the survival window: ${QUOTA_18_SEP}`],
  ];
  it.each(cases)('%s', (_name, err) => {
    expect(sweepDisposition(err)).toBe('quota');
  });
});

describe("sweepDisposition — the row's own results and code bugs are not retried", () => {
  const cases: Array<[string, unknown]> = [
    ['archive miss', new Error('missing trie node 0xabc')],
    ['genuine revert', new Error('execution reverted')],
    ['unknown upstream text', new Error('upstream RPC error')],
    ['code bug', new TypeError("Cannot read properties of undefined (reading 'x')")],
    // the endpoint is not the failure (the old pattern read URLs too)
    ['revert behind a host named network', viemRpcError('execution reverted', 'https://robinhood-network.rpc.example/KEY')],
    ['reason: quoter revert', 'quoter revert at horizon block'],
    ['reason: quoter archive', 'quoter archive at horizon block'],
    ['reason: no liquidity events', 'no liquidity events observed for this pool'],
    ['reason: log cap', 'could not scan the survival window: log cap hit (5000 >= 5000); series truncated'],
    ['reason: cluster replay', 'too many cluster transfers to replay reliably'],
    ['reason: no quoter', 'no swap after the reference window and no v4 quoter available'],
    ['reason: degenerate quote', 'spot sell quote returns 0 (degenerate quote)'],
    ['reason: non-v4', 'sell-impact quote only implemented for v4 pools'],
  ];
  it.each(cases)('%s', (_name, err) => {
    expect(sweepDisposition(err)).toBe('fail');
  });
});
