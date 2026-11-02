import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type {
  CaptureDrainExecutor,
  CaptureDrainStatement,
} from './webhook-capture-pg-executor';
import { createPgCaptureQueue } from './webhook-capture-queue';

const claimRow = {
  capture_id: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
  claim_token: '6b9d2f4a-3c1e-4a5b-9d8f-2e4b6a8c0d12',
  raw_hex: '7b7d',
  signature: 'ab'.repeat(64),
  key_version: 'k-0123456789abcdef',
  key_families: ['bank'],
  attempts: 1,
  event_type: 'bank-transfer.inflow.success',
  provider_transaction_id: 'txn-1',
};

const status = {
  pending: 2,
  claimed: 0,
  needsReview: 0,
  oldestUnprocessedAt: '2026-10-30T11:58:00.000Z',
  lastCapturedAt: '2026-10-30T11:59:00.000Z',
  lastProcessedAt: null,
};

function executorReturning(rows: unknown[] | Error) {
  const query = vi.fn(
    async (
      _statement: CaptureDrainStatement,
      _parameters: readonly unknown[]
    ) => {
      if (rows instanceof Error) throw rows;
      return rows;
    }
  );
  const executor: CaptureDrainExecutor = {
    query,
    verifySession: async () => ({ ok: true }),
  };
  return { executor, query };
}

describe('createPgCaptureQueue', () => {
  it('claims with the same lease and inline-processing grace as the web queue', async () => {
    const { executor, query } = executorReturning([claimRow]);
    await expect(createPgCaptureQueue(executor).claim(10)).resolves.toEqual([
      claimRow,
    ]);
    expect(query).toHaveBeenCalledWith('claim', [10, 300, 120]);
  });

  it('refuses malformed claim rows and hides executor detail', async () => {
    const malformed = executorReturning([{ ...claimRow, raw_hex: 'zz' }]);
    await expect(
      createPgCaptureQueue(malformed.executor).claim(10)
    ).rejects.toThrow('PiggyVest capture claim failed');

    const failing = executorReturning(new Error('host db.internal refused'));
    const failure = createPgCaptureQueue(failing.executor).claim(10);
    await expect(failure).rejects.toThrow('PiggyVest capture claim failed');
    await expect(failure).rejects.not.toThrow(/db\.internal/);
  });

  it('resolves through the fenced function and reports a lost lease as false', async () => {
    const won = executorReturning([{ resolved: true }]);
    await expect(
      createPgCaptureQueue(won.executor).resolve(
        claimRow.capture_id,
        claimRow.claim_token,
        'deferred',
        'REPLAY_DEFERRED_LEGACY_FAMILY'
      )
    ).resolves.toBe(true);
    expect(won.query).toHaveBeenCalledWith('resolve', [
      claimRow.capture_id,
      claimRow.claim_token,
      'deferred',
      'REPLAY_DEFERRED_LEGACY_FAMILY',
    ]);

    const lost = executorReturning([{ resolved: false }]);
    await expect(
      createPgCaptureQueue(lost.executor).resolve(
        claimRow.capture_id,
        claimRow.claim_token,
        'processed',
        null
      )
    ).resolves.toBe(false);
  });

  it.each([
    ['no row', []],
    ['two rows', [{ resolved: true }, { resolved: true }]],
    ['a non-boolean answer', [{ resolved: 'true' }]],
  ])('treats %s from resolve as a failure, never as success', async (_label, rows) => {
    const { executor } = executorReturning(rows);
    await expect(
      createPgCaptureQueue(executor).resolve(
        claimRow.capture_id,
        claimRow.claim_token,
        'processed',
        null
      )
    ).rejects.toThrow('PiggyVest capture resolve failed');
  });

  it('reads the metadata-only status counters', async () => {
    const { executor, query } = executorReturning([{ status }]);
    await expect(createPgCaptureQueue(executor).status()).resolves.toEqual(
      status
    );
    expect(query).toHaveBeenCalledWith('status', []);

    const bad = executorReturning([{ status: { pending: 'x' } }]);
    await expect(createPgCaptureQueue(bad.executor).status()).rejects.toThrow(
      'PiggyVest capture status failed'
    );
  });
});
