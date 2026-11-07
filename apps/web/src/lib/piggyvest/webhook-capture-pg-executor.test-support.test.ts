import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { deterministicTestUuid } from './deterministic-test-data.test-support';
import {
  createStatefulCaptureExecutor,
  scriptedCaptureExecutor,
} from './webhook-capture-pg-executor.test-support';
import { createPgCaptureQueue } from './webhook-capture-queue';

const T0 = Date.parse('2026-10-30T12:00:00.000Z');
const SECOND = 1000;

const claimed: PiggyvestClaimedCapture = {
  capture_id: deterministicTestUuid('support:capture'),
  claim_token: deterministicTestUuid('support:claim'),
  raw_hex: '7b7d',
  signature: 'ab'.repeat(64),
  key_version: 'k-0123456789abcdef',
  key_families: ['bank'],
  attempts: 1,
  event_type: 'bank-transfer.inflow.success',
  provider_transaction_id: 'txn-1',
};

function model() {
  let now = T0;
  const store = createStatefulCaptureExecutor(() => now);
  const queue = createPgCaptureQueue(store.executor);
  const stored = store.insert({
    raw_hex: '7b7d',
    signature: 'ab'.repeat(64),
    key_families: ['bank'],
    event_type: 'bank-transfer.inflow.success',
  });
  return {
    ...store,
    queue,
    stored,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('scriptedCaptureExecutor', () => {
  it('answers claims batch by batch and records each resolve through the pg queue', async () => {
    const resolves: string[] = [];
    const executor = scriptedCaptureExecutor([[claimed]], (call) => {
      resolves.push(`${call.id}:${call.state}:${call.error}`);
      return call.state !== 'pending';
    });
    const queue = createPgCaptureQueue(executor);

    await expect(queue.claim(5)).resolves.toEqual([claimed]);
    await expect(queue.claim(5)).resolves.toEqual([]);
    await expect(
      queue.resolve(claimed.capture_id, claimed.claim_token, 'processed', null)
    ).resolves.toBe(true);
    await expect(
      queue.resolve(claimed.capture_id, claimed.claim_token, 'pending', 'X')
    ).resolves.toBe(false);
    expect(resolves).toEqual([
      `${claimed.capture_id}:processed:null`,
      `${claimed.capture_id}:pending:X`,
    ]);
    expect(executor.statements).toEqual([
      'claim',
      'claim',
      'resolve',
      'resolve',
    ]);
    await expect(queue.status()).resolves.toMatchObject({ pending: 0 });
  });
});

describe('createStatefulCaptureExecutor', () => {
  it('holds a fresh capture back for the inline-processing grace period', async () => {
    const { queue, advance } = model();
    await expect(queue.claim(5)).resolves.toEqual([]);
    advance(120 * SECOND);
    await expect(queue.claim(5)).resolves.toHaveLength(1);
  });

  it('leases a claimed row and re-claims it only after the lease expires, with a new token', async () => {
    const { queue, advance, rows } = model();
    advance(121 * SECOND);
    const [first] = await queue.claim(5);
    expect(first?.attempts).toBe(1);
    advance(299 * SECOND);
    await expect(queue.claim(5)).resolves.toEqual([]);
    advance(2 * SECOND);
    const [second] = await queue.claim(5);
    expect(second?.capture_id).toBe(first?.capture_id);
    expect(second?.claim_token).not.toBe(first?.claim_token);
    expect(second?.attempts).toBe(2);

    // The crashed worker's stale token can no longer settle the row.
    await expect(
      queue.resolve(
        first?.capture_id ?? '',
        first?.claim_token ?? '',
        'processed',
        null
      )
    ).resolves.toBe(false);
    await expect(
      queue.resolve(
        second?.capture_id ?? '',
        second?.claim_token ?? '',
        'processed',
        null
      )
    ).resolves.toBe(true);
    expect(rows[0]?.processing_state).toBe('processed');
  });

  it('defers without spending the attempt and backs a failed row off', async () => {
    const { queue, advance, rows, stored } = model();
    advance(121 * SECOND);
    const [first] = await queue.claim(5);
    await queue.resolve(stored.id, first?.claim_token ?? '', 'deferred', 'D');
    expect(rows[0]).toMatchObject({
      processing_state: 'pending',
      attempts: 0,
      config_deferrals: 1,
      last_error: 'D',
    });
    expect(rows[0]?.next_attempt_at).toBe(T0 + 121 * SECOND + 60 * SECOND);

    advance(60 * SECOND);
    const [second] = await queue.claim(5);
    await queue.resolve(stored.id, second?.claim_token ?? '', 'pending', 'P');
    expect(rows[0]).toMatchObject({ processing_state: 'pending', attempts: 1 });
    expect(rows[0]?.next_attempt_at).toBe(T0 + 181 * SECOND + 60 * SECOND);
  });

  it('lets successful inline completion win without letting a stale worker overwrite it', async () => {
    const { completeInline, queue, advance, rows, stored } = model();
    advance(121 * SECOND);
    const [claim] = await queue.claim(5);
    expect(completeInline(stored.id)).toBe(true);
    expect(
      await queue.resolve(
        stored.id,
        claim?.claim_token ?? '',
        'needs_review',
        'STALE'
      )
    ).toBe(false);
    expect(rows[0]?.processing_state).toBe('processed');
  });

  it('refuses a tokenless resolve through the drain statement (claim-bound entry point)', async () => {
    const { executor, rows, stored } = model();
    await expect(
      executor.query('resolve', [stored.id, null, 'processed', null])
    ).rejects.toThrow();
    expect(rows[0]?.processing_state).toBe('pending');
  });

  it('reports metadata-only counters', async () => {
    const { queue } = model();
    await expect(queue.status()).resolves.toEqual({
      pending: 1,
      claimed: 0,
      needsReview: 0,
      claimRecoveryVersion: 1,
      oldestUnprocessedAt: new Date(T0).toISOString(),
      lastCapturedAt: new Date(T0).toISOString(),
      lastProcessedAt: null,
    });
  });
});
