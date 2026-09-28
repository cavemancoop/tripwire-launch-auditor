import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, parseRedisUrl } from '../src/queues';

describe('parseRedisUrl', () => {
  it('extracts host, port and password', () => {
    expect(parseRedisUrl('redis://:secret@127.0.0.1:6380')).toEqual({
      host: '127.0.0.1',
      port: 6380,
      password: 'secret',
    });
  });

  it('uses the same database, TLS and decoded credentials as the API producer', () => {
    expect(parseRedisUrl('rediss://user:p%40ss@localhost:6380/7')).toEqual({
      host: 'localhost', port: 6380, username: 'user', password: 'p@ss', db: 7, tls: {},
    });
  });

  it('defaults the port to 6379 and omits an absent password', () => {
    expect(parseRedisUrl('redis://localhost')).toEqual({
      host: 'localhost',
      port: 6379,
    });
  });
});

describe('QUEUE_NAMES', () => {
  it('registers every pipeline queue', () => {
    expect(Object.values(QUEUE_NAMES).sort()).toEqual(
      ['assess', 'commits', 'deepdive', 'features', 'metabolism', 'outcomes', 'watcher'].sort(),
    );
  });
});
