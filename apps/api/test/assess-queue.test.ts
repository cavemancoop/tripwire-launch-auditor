import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  add: vi.fn(),
  getDeduplicationJobId: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock('bullmq', () => ({
  Queue: class {
    add = fake.add;
    getDeduplicationJobId = fake.getDeduplicationJobId;
    getJob = fake.getJob;
  },
}));

import { makeAssessEnqueuer } from '../src/assess-queue';

beforeEach(() => {
  fake.add.mockReset().mockResolvedValue({ id: 'ignored-attempt' });
  fake.getDeduplicationJobId.mockReset().mockResolvedValue('actual-job');
  fake.getJob.mockReset().mockResolvedValue({ id: 'ignored-attempt' });
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
    expect(fake.getDeduplicationJobId).toHaveBeenCalledWith('0xabcd');
    expect(result.id).toBe('actual-job');
  });

  it('returns the added job ID when the job exists after the dedup key clears', async () => {
    fake.getDeduplicationJobId.mockResolvedValue(null);
    const result = await makeAssessEnqueuer('redis://localhost:6379')({ tokenAddress: '0xabc' });
    expect(result.id).toBe('ignored-attempt');
    expect(fake.getJob).toHaveBeenCalledWith('ignored-attempt');
  });

  it('does not return an ignored attempt ID when the retained job finishes during lookup', async () => {
    fake.getDeduplicationJobId.mockResolvedValue(null);
    fake.getJob.mockResolvedValue(undefined);
    const result = await makeAssessEnqueuer('redis://localhost:6379')({ tokenAddress: '0xabc' });
    expect(result.id).toBeUndefined();
  });
});
