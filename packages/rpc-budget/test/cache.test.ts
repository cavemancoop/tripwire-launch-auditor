import { describe, expect, it } from 'vitest';
import { cacheKey, isCacheable, ResponseCache, stableStringify } from '../src/cache';

describe('isCacheable', () => {
  it('rejects methods with no block anchor', () => {
    expect(isCacheable('eth_blockNumber', [])).toBe(false);
    expect(isCacheable('eth_gasPrice', [])).toBe(false);
    expect(isCacheable('eth_sendRawTransaction', ['0xdead'])).toBe(false);
  });

  it('requires a concrete block for state reads', () => {
    expect(isCacheable('eth_getCode', ['0xabc', 'latest'])).toBe(false);
    expect(isCacheable('eth_getCode', ['0xabc', '0x10'])).toBe(true);
    expect(isCacheable('eth_call', [{ to: '0xabc', data: '0x' }, 'pending'])).toBe(false);
    expect(isCacheable('eth_call', [{ to: '0xabc', data: '0x' }, '0x2a'])).toBe(true);
  });

  it('requires a bounded toBlock for eth_getLogs', () => {
    expect(isCacheable('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x2' }])).toBe(true);
    expect(isCacheable('eth_getLogs', [{ fromBlock: '0x1' }])).toBe(false);
    expect(isCacheable('eth_getLogs', [{ fromBlock: '0x1', toBlock: 'latest' }])).toBe(false);
  });

  it('hash-addressed reads are always cacheable', () => {
    expect(isCacheable('eth_getTransactionByHash', ['0xhash'])).toBe(true);
    expect(isCacheable('eth_getTransactionReceipt', ['0xhash'])).toBe(true);
  });
});

describe('cacheKey', () => {
  it('is stable regardless of object key order', () => {
    const a = cacheKey(4663, 'eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x2', address: '0xa' }]);
    const b = cacheKey(4663, 'eth_getLogs', [{ address: '0xa', toBlock: '0x2', fromBlock: '0x1' }]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('returns null for uncacheable calls', () => {
    expect(cacheKey(4663, 'eth_blockNumber', [])).toBeNull();
    expect(cacheKey(4663, 'eth_getCode', ['0xabc', 'latest'])).toBeNull();
  });

  it('separates by chainId and method', () => {
    expect(cacheKey(1, 'eth_getCode', ['0xabc', '0x1'])).not.toBe(
      cacheKey(4663, 'eth_getCode', ['0xabc', '0x1']),
    );
  });
});

describe('stableStringify', () => {
  it('sorts nested keys', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('ResponseCache', () => {
  it('stores and retrieves, counting hits and misses', () => {
    const c = new ResponseCache();
    expect(c.has('k')).toBe(false);
    c.get('k');
    expect(c.misses).toBe(1);
    c.set('k', 42);
    expect(c.get('k')).toBe(42);
    expect(c.hits).toBe(1);
  });

  it('evicts the oldest entry past maxEntries', () => {
    const c = new ResponseCache(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
    expect(c.size).toBe(2);
  });

  it('does not overwrite an existing key', () => {
    const c = new ResponseCache();
    c.set('a', 1);
    c.set('a', 2);
    expect(c.get('a')).toBe(1);
  });
});
