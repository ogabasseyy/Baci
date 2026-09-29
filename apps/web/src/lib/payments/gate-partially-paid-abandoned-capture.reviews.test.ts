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
  amount: 70,
  gateway_reference: 'BAC-OLD',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  metadata: { order_payment_allocation: 'merchant_invoice_partial' },
  order_id: 'order-1',
  platform_fee: 2,
};

const providerData = {
  amount: 7000,
  currency: 'NGN',
  fees: 100,
  id: 555,
  reference: 'BAC-OLD',
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

function reviewClient({
  insertError = null,
  order,
  rpcData,
  stampData = true,
}: {
  insertError?: unknown;
  order?: unknown;
  rpcData: unknown;
  stampData?: unknown;
}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const maybeSingle = vi.fn().mockResolvedValue({ data: order, error: null });
  const from = vi.fn((table: string) => {
    if (table === 'orders') {
      return {
        eq: vi.fn().mockReturnThis(),
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      };
    }
    return { insert };
  });
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: rpcData, error: null })
    .mockResolvedValue({ data: stampData, error: null });
  return { from, insert, rpc };
}

describe('gatePartiallyPaidAbandonedCapture reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(true);
  });

  it('files an overpayment as a duplicate instead of promoting the order', async () => {
    const db = reviewClient({
      rpcData: {
        error_code: 'AMOUNT_EXCEEDS_REMAINING_BALANCE',
        outcome: 'review_required',
        remaining_balance: 50,
      },
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toBe('done');
    expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          gateway: 'paystack',
          providerAmount: 7000,
          providerReference: '555',
        }),
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
  });

  it('fails when the overpayment duplicate review cannot be filed', async () => {
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(false);
    const db = reviewClient({
      rpcData: {
        error_code: 'AMOUNT_EXCEEDS_REMAINING_BALANCE',
        outcome: 'review_required',
        remaining_balance: 50,
      },
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toBe('done');
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('duplicate_capture_review_failed');
  });

  it('files a duplicate when the order paid concurrently', async () => {
    const db = reviewClient({
      order: { payment_status: 'paid' },
      rpcData: { outcome: 'standard_completion', reason: 'order_terminal' },
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toBe('done');
    expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalled();
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
  });

  it('lets the finalizer classify a concurrently cancelled order', async () => {
    const db = reviewClient({
      order: { payment_status: 'cancelled' },
      rpcData: { outcome: 'standard_completion', reason: 'order_terminal' },
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toBe('proceed');
    expect(mocks.fileDuplicatePaymentCapture).not.toHaveBeenCalled();
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('files a conflict review when the invoice leg no longer fits', async () => {
    const db = reviewClient({
      rpcData: {
        error_code: 'PARTIAL_PAYMENT_CONTRACT_MISMATCH',
        outcome: 'review_required',
      },
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toBe('done');
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'merchant_invoice_partial_payment_conflict',
        merchant_id: 'merchant-1',
        txn_id: 'attempt-1',
      })
    );
    expect(db.rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'merchant_invoice_partial_conflict_reviewed',
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
  });

  it('fails when the conflict review cannot be persisted', async () => {
    const db = reviewClient({
      insertError: { code: 'ECONNRESET' },
      rpcData: {
        error_code: 'PARTIAL_PAYMENT_CONTRACT_MISMATCH',
        outcome: 'review_required',
      },
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toBe('done');
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_conflict_review_failed');
  });
});
