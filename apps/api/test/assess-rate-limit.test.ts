import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  defineCommand: vi.fn(),
  runCommand: vi.fn(),
}));
vi.mock('bullmq', () => ({
  Queue: class {
    client = Promise.resolve(fake);
  },
}));

import {
  ASSESS_GLOBAL_PER_MINUTE,
  ASSESS_PER_IP_PER_MINUTE,
  makeAssessRateLimiter,
} from '../src/assess-rate-limit';

beforeEach(() => {
  fake.defineCommand.mockReset();
  fake.runCommand.mockReset().mockResolvedValue(1);
});

describe('assessment admission wiring', () => {
  it('shares a global bucket and separates hashed client IPs in one Redis command', async () => {
    const limit = makeAssessRateLimiter('redis://localhost:6379', () => 61_000);
    expect((await limit('203.0.113.1')).allowed).toBe(true);
    expect((await limit('203.0.113.2')).allowed).toBe(true);
    expect(fake.defineCommand).toHaveBeenCalledTimes(1);
    const first = fake.runCommand.mock.calls[0]![1] as string[];
    const second = fake.runCommand.mock.calls[1]![1] as string[];
    expect(first[0]).toBe('tripwire:assess:global:1');
    expect(second[0]).toBe(first[0]);
    expect(first[1]).toMatch(/^tripwire:assess:ip:[0-9a-f]{32}:1$/);
    expect(first[1]).not.toBe(second[1]);
    expect(first.slice(2)).toEqual([ASSESS_GLOBAL_PER_MINUTE, ASSESS_PER_IP_PER_MINUTE]);
  });

  it('returns a bounded Retry-After when Redis declines admission', async () => {
    fake.runCommand.mockResolvedValue(0);
    const result = await makeAssessRateLimiter('redis://localhost:6379', () => 119_500)('203.0.113.1');
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});
