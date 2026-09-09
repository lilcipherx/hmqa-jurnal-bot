import { randomUUID } from 'node:crypto';
import { redisConnectionFromUrl } from '@hmqa/shared';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const redisUrl = process.env.REDIS_URL;
const suite = redisUrl ? describe : describe.skip;
const queueName = `hmqa-runtime-${randomUUID()}`;
const connection = redisUrl
  ? { ...redisConnectionFromUrl(redisUrl), maxRetriesPerRequest: null }
  : undefined;
const attemptCounts = new Map<string, number>();
let queue: Queue;
let events: QueueEvents;
let worker: Worker;

function createWorker() {
  return new Worker(
    queueName,
    (job: Job<{ mode: string }>) => {
      const count = (attemptCounts.get(job.id ?? '') ?? 0) + 1;
      attemptCounts.set(job.id ?? '', count);
      if (job.data.mode === 'retry' && count < 3) throw new Error('EXPECTED_RETRY');
      if (job.data.mode === 'fail') throw new Error('EXPECTED_FAILURE');
      return Promise.resolve({ count });
    },
    { connection: connection! },
  );
}

suite('real Redis and BullMQ behavior', () => {
  beforeAll(async () => {
    queue = new Queue(queueName, { connection: connection! });
    events = new QueueEvents(queueName, { connection: connection! });
    worker = createWorker();
    await Promise.all([events.waitUntilReady(), worker.waitUntilReady()]);
  });

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
  });

  it('consumes one job for a duplicate durable job id', async () => {
    const jobId = `duplicate-${randomUUID()}`;
    const first = await queue.add(
      'duplicate',
      { mode: 'success' },
      { jobId, removeOnComplete: false },
    );
    const duplicate = await queue.add(
      'duplicate',
      { mode: 'success' },
      { jobId, removeOnComplete: false },
    );
    expect(duplicate.id).toBe(first.id);
    await first.waitUntilFinished(events, 5_000);
    expect(attemptCounts.get(jobId)).toBe(1);
  });

  it('retries with exponential backoff and eventually completes', async () => {
    const jobId = `retry-${randomUUID()}`;
    const job = await queue.add(
      'retry',
      { mode: 'retry' },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 25 },
        removeOnComplete: false,
      },
    );
    await job.waitUntilFinished(events, 5_000);
    expect(attemptCounts.get(jobId)).toBe(3);
    expect(await job.getState()).toBe('completed');
  });

  it('retains a terminal failed job for dead-letter operations', async () => {
    const jobId = `failed-${randomUUID()}`;
    const job = await queue.add(
      'failed',
      { mode: 'fail' },
      {
        jobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 25 },
        removeOnFail: false,
      },
    );
    await expect(job.waitUntilFinished(events, 5_000)).rejects.toThrow('EXPECTED_FAILURE');
    expect(attemptCounts.get(jobId)).toBe(2);
    expect(await job.getState()).toBe('failed');
  });

  it('consumes a waiting job after a graceful worker restart', async () => {
    await worker.close();
    const jobId = `restart-${randomUUID()}`;
    const job = await queue.add('restart', { mode: 'success' }, { jobId, removeOnComplete: false });
    expect(await job.getState()).toBe('waiting');
    worker = createWorker();
    await worker.waitUntilReady();
    await job.waitUntilFinished(events, 5_000);
    expect(attemptCounts.get(jobId)).toBe(1);
  });
});
