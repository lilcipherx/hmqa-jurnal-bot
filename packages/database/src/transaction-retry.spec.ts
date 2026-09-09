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
    const transaction = vi.fn().mockResolvedValue('committed');

    await expect(
      serializableTransactionWithRetry(
        { $transaction: transaction } as never,
        () => Promise.resolve('committed'),
        { maxWait: 5_000, timeout: 10_000 },
      ),
    ).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    });
  });
});
