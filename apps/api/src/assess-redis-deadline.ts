/** Bound the API wait even when BullMQ is still trying to establish Redis. */
export class AssessRedisTimeoutError extends Error {
  constructor() { super('assessment Redis operation timed out'); }
}

export async function withAssessRedisDeadline<T>(operation: Promise<T>, timeoutMs = 4_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new AssessRedisTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
