import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fileDuplicatePaymentCapture: vi.fn(),
}));

vi.mock('./file-duplicate-payment-capture', () => ({
  fileDuplicatePaymentCapture: mocks.fileDuplicatePaymentCapture,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { gatePartiallyPaidAbandonedCapture } from './gate-partially-paid-abandoned-capture';

const attempt = {
  amount: 50,
  gateway_reference: 'BAC-SHORT',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  metadata: {},
  order_id: 'order-1',
  platform_fee: 2,
};

const providerData = {
  amount: 5000,
  currency: 'NGN',
  fees: 100,
  id: 555,
  reference: 'BAC-SHORT',
  status: 'success',
};

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

function shortClient({
  confirmReview = { txn_id: 'attempt-1' },
  insertError = null,
  stampData = true,
}: {
  confirmReview?: unknown;
  insertError?: unknown;
  stampData?: unknown;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: { amount_paid: 30, total: 100 }, error: null });
  const confirmSingle = vi
    .fn()
    .mockResolvedValue({ data: confirmReview, error: null });
  const from = vi.fn((table: string) => {
    if (table === 'orders') {
      return {
        eq: vi.fn().mockReturnThis(),
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      };
    }
    if (table === 'reconciliation_review') {
      return {
        eq: vi.fn().mockReturnThis(),
        insert,
        is: vi.fn().mockReturnThis(),
        maybeSingle: confirmSingle,
        select: vi.fn().mockReturnThis(),
      };
    }
    return { insert };
  });
  const rpc = vi.fn().mockResolvedValue({ data: stampData, error: null });
  return { from, insert, rpc };
}

describe('gatePartiallyPaidAbandonedCapture short captures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(true);
  });

  it('treats a redelivered short capture as filed and still retires it', async () => {
    const db = shortClient({ insertError: { code: '23505' } });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toEqual({ status: 'done' });
    expect(db.rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'BAC-SHORT',
        p_resolution: 'partial_capture_short_reviewed',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('holds for retry when the short-capture review cannot be filed', async () => {
    const db = shortClient({ insertError: { code: '50000' } });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toEqual({ status: 'done' });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_short_review_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
  });

  it('holds for retry when the short-capture stamp misses', async () => {
    const db = shortClient({ stampData: false });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toEqual({ status: 'done' });
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'partial_capture_short_requires_review',
        merchant_id: 'merchant-1',
        reason: expect.stringContaining('5000 of 7000 kobo'),
      })
    );
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_short_stamp_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
  });

  it('holds without retiring when the short-capture conflict belongs to another order', async () => {
    const db = shortClient({
      confirmReview: null,
      insertError: { code: '23505' },
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toEqual({ status: 'done' });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_short_review_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
  });
});
