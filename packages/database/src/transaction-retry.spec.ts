import { describe, expect, it, vi } from 'vitest';
import {
  isSerializableTransactionConflict,
  serializableTransactionWithRetry,
  withSerializableTransactionRetry,
} from './transaction-retry.js';

describe('serializable transaction retry', () => {
  it('retries an aborted serializable transaction and returns the committed result', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockResolvedValue('committed');

    await expect(withSerializableTransactionRetry(operation)).resolves.toBe('committed');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('absorbs a bounded burst of serializable conflicts', async () => {
    vi.useFakeTimers();
    try {
      const operation = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockResolvedValue('committed');

      const result = withSerializableTransactionRetry(operation);
      await vi.runAllTimersAsync();

      await expect(result).resolves.toBe('committed');
      expect(operation).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry unrelated failures', async () => {
    const error = new Error('DATABASE_UNAVAILABLE');
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error);

    await expect(withSerializableTransactionRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops after the bounded attempt count', async () => {
    const error = { code: 'P2034' };
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error);

    await expect(withSerializableTransactionRetry(operation, 2)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(isSerializableTransactionConflict(error)).toBe(true);
  });

  it('always requests serializable isolation from Prisma', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const transaction = vi.fn((operation: (client: unknown) => Promise<unknown>) =>
      operation({ $executeRaw: executeRaw }),
    );

    await expect(
      serializableTransactionWithRetry(
        { $transaction: transaction } as never,
        () => Promise.resolve('committed'),
        { lockAuditChain: true, maxWait: 5_000, timeout: 10_000 },
      ),
    ).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    });
    expect(executeRaw).toHaveBeenCalledOnce();
  });
});
