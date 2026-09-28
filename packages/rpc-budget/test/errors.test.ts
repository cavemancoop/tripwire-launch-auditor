import { describe, expect, it } from 'vitest';
import { RpcRequestError } from 'viem';
import { classifyRpcError, hasProviderFailure, isProviderFailureKind, rpcErrorKinds, type RpcErrorKind } from '../src/errors';

// The exact provider text from the 2026-09-18 outage (CHANGELOG.md).
const QUOTA_18_SEP = "You've reached your monthly quota of Request Units";

class Named extends Error {
  constructor(name: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = name;
    Object.assign(this, extra);
  }
}

/** viem's RpcRequestError shape: the provider text lives in `details`, not the first line */
const viemRpcError = (details: string, url = 'https://rpc.example/KEY') =>
  new Named(
    'RpcRequestError',
    `RPC Request failed.\n\nURL: ${url}\nRequest body: {"method":"eth_getLogs"}\n\nDetails: ${details}\nVersion: viem@2`,
    { shortMessage: 'RPC Request failed.', details },
  );

const table: Array<[string, unknown, RpcErrorKind]> = [
  ['exact 18 Sep quota text', new Error(QUOTA_18_SEP), 'quota'],
  ['quota text as a bare string', QUOTA_18_SEP, 'quota'],
  ['quota in viem details', viemRpcError(QUOTA_18_SEP), 'quota'],
  [
    'quota two causes deep',
    new Named('CallExecutionError', 'Execution failed.', {
      cause: new Named('ContractFunctionExecutionError', 'wrapped', { cause: viemRpcError(QUOTA_18_SEP) }),
    }),
    'quota',
  ],
  ['quota delivered as HTTP 429 is still quota', new Error(`HTTP request failed.\n\nStatus: 429\nDetails: ${QUOTA_18_SEP}`), 'quota'],
  ['429', new Error('429 Too Many Requests'), 'rate_limit'],
  ['ordofi busy', viemRpcError('network is busy, try again in a moment (-32005)'), 'rate_limit'],
  ['blockmachine rate limit', new Error('rate limit exceeded'), 'rate_limit'],
  ['request limit (former sweep-only text)', new Error('daily request limit reached'), 'rate_limit'],
  ['-32097 (former sweep-only text)', viemRpcError('-32097'), 'rate_limit'],
  ['viem timeout', new Named('TimeoutError', 'The request took too long to respond.', { details: 'The request timed out.' }), 'transport'],
  ['request timed out in viem details', viemRpcError('request timed out'), 'transport'],
  ['viem http failure', new Named('HttpRequestError', 'HTTP request failed.\n\nStatus: 503'), 'transport'],
  ['socket hang up', new Error('socket hang up'), 'transport'],
  ['node fetch', new Named('TypeError', 'fetch failed', { cause: new Error('connect ECONNREFUSED 10.0.0.1:443') }), 'transport'],
  ['bare network (former sweep-only text)', new Error('network connection lost'), 'transport'],
  ['archive miss', new Error('missing trie node 0xabc (path )'), 'archive'],
  ['header not found', viemRpcError('header not found'), 'archive'],
  ['genuine revert', new Error('execution reverted'), 'revert'],
  [
    'wrapped revert',
    new Named('CallExecutionError', 'Execution reverted with reason: TRANSFER_FAILED.', {
      cause: new Named('ExecutionRevertedError', 'Execution reverted with reason: TRANSFER_FAILED.'),
    }),
    'revert',
  ],
  ['generic upstream error', new Error('upstream RPC error'), 'unknown'],
  ['code bug', new TypeError("Cannot read properties of undefined (reading 'x')"), 'unknown'],
  ['undefined', undefined, 'unknown'],
  ['null', null, 'unknown'],
  // the endpoint is not the failure: provider hosts carry digits and words
  ['archive miss behind a host with 429 in it', viemRpcError('missing trie node', 'https://nd-429-005-777.p2pify.com/KEY'), 'archive'],
  ['revert behind a host named network', viemRpcError('execution reverted', 'https://robinhood-network.rpc.example/KEY'), 'revert'],
  ['unknown behind a ws host with capacity in it', new Error('upstream RPC error at wss://capacity.rpc.example/KEY'), 'unknown'],
];

describe('classifyRpcError (Package 4a)', () => {
  it.each(table)('%s', (_name, err, kind) => {
    expect(classifyRpcError(err)).toBe(kind);
  });

  it('stops on a cyclic cause chain', () => {
    const e = new Error('upstream RPC error') as Error & { cause?: unknown };
    e.cause = e;
    expect(classifyRpcError(e)).toBe('unknown');
  });

  it('ignores a 429 in viem request-body params while preserving real provider details', () => {
    const body = { method: 'eth_call', params: [{ to: '0x1111111111111111111111111111111111114290', data: '0x' }, 'latest'] };
    const revert = new RpcRequestError({ body, error: { code: 3, message: 'execution reverted' }, url: 'https://rpc.example/KEY' });
    expect(classifyRpcError(revert)).toBe('revert');
    expect(rpcErrorKinds(revert)).not.toContain('rate_limit');
    expect(hasProviderFailure(revert)).toBe(false);
    const quota = new RpcRequestError({ body, error: { code: 429, message: QUOTA_18_SEP }, url: 'https://rpc.example/KEY' });
    expect(classifyRpcError(quota)).toBe('quota');
  });

  it('only provider-side kinds are provider failures', () => {
    const provider = (['quota', 'rate_limit', 'transport', 'archive', 'revert', 'unknown'] as RpcErrorKind[]).filter(
      isProviderFailureKind,
    );
    expect(provider).toEqual(['quota', 'rate_limit', 'transport']);
  });
});

describe('rpcErrorKinds / hasProviderFailure (review 896555be)', () => {
  it('lists every kind in precedence order; the first is the classification', () => {
    const err = new Error(`HTTP request failed.\n\nStatus: 429\nDetails: ${QUOTA_18_SEP}`);
    expect(rpcErrorKinds(err)).toEqual(['quota', 'rate_limit', 'transport']);
    expect(rpcErrorKinds(new Error('upstream RPC error'))).toEqual([]);
  });

  it('sees a provider failure beside an archive miss or a revert', () => {
    const archiveAndTimeout = new Named('Error', 'header not found', { cause: new Error('request timed out') });
    expect(classifyRpcError(archiveAndTimeout)).toBe('archive');
    expect(hasProviderFailure(archiveAndTimeout)).toBe(true);
    expect(hasProviderFailure(new Error('execution reverted: 429'))).toBe(true);
  });

  it("is false for the row's own results", () => {
    for (const e of [new Error('missing trie node'), new Error('execution reverted'), new Error('upstream RPC error'), undefined]) {
      expect(hasProviderFailure(e)).toBe(false);
    }
  });
});
