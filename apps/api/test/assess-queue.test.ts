import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  defineCommand: vi.fn(),
  runCommand: vi.fn(),
}));
vi.mock('bullmq', () => ({
  Queue: class {
    on = vi.fn();
    disconnect = vi.fn().mockResolvedValue(undefined);
    add = fake.add;
    getJob = fake.getJob;
    client = Promise.resolve({ defineCommand: fake.defineCommand, runCommand: fake.runCommand });
    toKey = (key: string) => `bull:assess:${key}`;
  },
}));

import { makeAssessEnqueuer } from '../src/assess-queue';

beforeEach(() => {
  fake.add.mockReset().mockResolvedValue({ id: 'actual-job' });
  fake.getJob.mockReset().mockResolvedValue({ id: 'actual-job' });
  fake.defineCommand.mockReset();
  fake.runCommand.mockReset().mockResolvedValue(0);
});

describe('assessment queue producer', () => {
  it('uses BullMQ token deduplication and returns the retained job ID', async () => {
    const enqueue = makeAssessEnqueuer('redis://localhost:6379');
    const result = await enqueue({ tokenAddress: '0xAbCd' });
    expect(fake.add).toHaveBeenCalledWith('assess', { tokenAddress: '0xAbCd' }, {
      deduplication: { id: '0xabcd' },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    expect(fake.getJob).toHaveBeenCalledWith('actual-job');
    expect(fake.runCommand).not.toHaveBeenCalled();
    expect(result.id).toBe('actual-job');
  });

  it('returns no nonexistent job ID after a fast completion', async () => {
    fake.getJob.mockResolvedValue(undefined);
    const result = await makeAssessEnqueuer('redis://localhost:6379')({ tokenAddress: '0xabc' });
    expect(result.id).toBeUndefined();
    expect(fake.runCommand).toHaveBeenCalledWith('tripwireRepairAssessDedupV1', ['bull:assess:de:0xabc', 'bull:assess:']);
  });

  it('retries once after atomically removing an orphaned dedup key', async () => {
    fake.add.mockResolvedValueOnce({ id: 'orphan' }).mockResolvedValueOnce({ id: 'new-job' });
    fake.getJob.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 'new-job' });
    fake.runCommand.mockResolvedValue(1);
    const result = await makeAssessEnqueuer('redis://localhost:6379')({ tokenAddress: '0xabc' });
    expect(result.id).toBe('new-job');
    expect(fake.add).toHaveBeenCalledTimes(2);
  });
});
