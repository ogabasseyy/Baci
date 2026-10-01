import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { fileConflictAndRetire } from './gate-partially-paid-abandoned-capture-conflict';

const attempt = {
  gateway_reference: 'BAC-CONFLICT',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

const filing = { errorCode: 'HTTP_409', reason: 'conflict reason' };

function harness() {
  return {
    hold: vi.fn().mockResolvedValue(undefined),
    summary: {
      completed: [] as string[],
      failed: false,
      reviewsFiled: [] as string[],
    },
  };
}

function conflictClient({
  confirmLookupError = null,
  confirmReview = { txn_id: 'attempt-1' },
  insertError = null,
  stampData = true,
  stampError = null,
}: {
  confirmLookupError?: unknown;
  confirmReview?: unknown;
  insertError?: unknown;
  stampData?: unknown;
  stampError?: unknown;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const confirmSingle = vi
    .fn()
    .mockResolvedValue({ data: confirmReview, error: confirmLookupError });
  const from = vi.fn(() => ({
    eq: vi.fn().mockReturnThis(),
    insert,
    is: vi.fn().mockReturnThis(),
    maybeSingle: confirmSingle,
    select: vi.fn().mockReturnThis(),
  }));
  const rpc = vi.fn().mockResolvedValue({ data: stampData, error: stampError });
  return { from, insert, rpc };
}

describe('fileConflictAndRetire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files the conflict review and retires the attempt', async () => {
    const db = conflictClient();
    const h = harness();

    const gate = await fileConflictAndRetire(
      { ...h, attempt, supabase: db as never },
      filing
    );

    expect(gate).toBe('done');
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'merchant_invoice_partial_payment_conflict',
        metadata: { error_code: 'HTTP_409' },
        txn_id: 'attempt-1',
      })
    );
    expect(db.rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'BAC-CONFLICT',
        p_resolution: 'merchant_invoice_partial_conflict_reviewed',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('treats a redelivered conflict as filed when this txn owns the open review', async () => {
    const db = conflictClient({ insertError: { code: '23505' } });
    const h = harness();

    const gate = await fileConflictAndRetire(
      { ...h, attempt, supabase: db as never },
      filing
    );

    expect(gate).toBe('done');
    expect(db.rpc).toHaveBeenCalled();
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('holds when the conflict collision belongs to another order', async () => {
    const db = conflictClient({
      confirmReview: null,
      insertError: { code: '23505' },
    });
    const h = harness();

    const gate = await fileConflictAndRetire(
      { ...h, attempt, supabase: db as never },
      filing
    );

    expect(gate).toBe('done');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_conflict_review_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
  });

  it('holds when the conflict review cannot be filed', async () => {
    const db = conflictClient({ insertError: { code: '50000' } });
    const h = harness();

    const gate = await fileConflictAndRetire(
      { ...h, attempt, supabase: db as never },
      filing
    );

    expect(gate).toBe('done');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_conflict_review_failed');
  });

  it('holds when the confirm lookup fails after a unique violation', async () => {
    const db = conflictClient({
      confirmLookupError: { message: 'boom' },
      insertError: { code: '23505' },
    });
    const h = harness();

    await fileConflictAndRetire(
      { ...h, attempt, supabase: db as never },
      filing
    );

    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_conflict_review_failed');
  });

  it('holds when the conflict stamp misses', async () => {
    const db = conflictClient({ stampData: false });
    const h = harness();

    const gate = await fileConflictAndRetire(
      { ...h, attempt, supabase: db as never },
      filing
    );

    expect(gate).toBe('done');
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_conflict_stamp_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
  });
});
