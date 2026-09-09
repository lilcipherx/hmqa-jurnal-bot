import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseClient } from './client.js';
import { Prisma } from './generated/client/client.js';

const defaultMaxAttempts = 4;

export function isSerializableTransactionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  );
}

export async function withSerializableTransactionRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = defaultMaxAttempts,
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new RangeError('SERIALIZABLE_RETRY_ATTEMPTS_INVALID');

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableTransactionConflict(error) || attempt >= maxAttempts) throw error;
      const exponentialDelayMs = 10 * 2 ** (attempt - 1);
      const jitterMs = Math.floor(Math.random() * 10);
      await delay(exponentialDelayMs + jitterMs);
    }
  }
}

interface SerializableTransactionOptions {
  readonly maxAttempts?: number;
  readonly maxWait?: number;
  readonly timeout?: number;
}

export function serializableTransactionWithRetry<T>(
  database: DatabaseClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> {
  return withSerializableTransactionRetry(
    () =>
      database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(options.maxWait === undefined ? {} : { maxWait: options.maxWait }),
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      }),
    options.maxAttempts,
  );
}
