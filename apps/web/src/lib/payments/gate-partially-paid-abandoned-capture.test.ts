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

function ordersClient(order: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: order, error });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({
    eq: vi.fn().mockReturnThis(),
    insert,
    maybeSingle,
    select: vi.fn().mockReturnThis(),
  }));
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { from, insert, rpc };
}

describe('gatePartiallyPaidAbandonedCapture routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileDuplicatePaymentCapture.mockResolvedValue(true);
  });

  it('proceeds to the finalizer when the capture exactly covers the invoice balance', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: 'standard_completion',
        reason: 'amount_now_completes_order',
      },
      error: null,
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: { from: vi.fn(), rpc } as never,
    });

    expect(gate).toEqual({ expectedOutstandingMinor: null, status: 'proceed' });
    expect(rpc).toHaveBeenCalledWith(
      'complete_merchant_invoice_partial_payment',
      expect.objectContaining({
        p_actor: 'cron:reconcile-gateway-paid-orders',
        p_order_id: 'order-1',
        p_payment_platform_fee: 2,
        p_settlement_reference: 'BAC-OLD',
        p_transaction_id: 'attempt-1',
        p_verified_gateway_fee: 1,
      })
    );
    expect(h.summary.completed).toEqual([]);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('records a strict underpayment without promoting the order', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        already_completed: false,
        amount_applied: 70,
        amount_paid: 100,
        balance_due: 0,
        order_number: 'ORD-1',
        outcome: 'partial_recorded',
        payment_status: 'partially_paid',
        shipping_status: 'pending',
      },
      error: null,
    });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: { from: vi.fn(), rpc } as never,
    });

    expect(gate).toEqual({ status: 'done' });
    expect(h.summary.completed).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
  });

  it('proceeds when a non-invoice capture covers the live balance', async () => {
    const plainAttempt = { ...attempt, metadata: {} };
    const db = ordersClient({ amount_paid: 30, total: 100 });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt: plainAttempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toEqual({
      expectedOutstandingMinor: 7000,
      status: 'proceed',
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('files a duplicate review for a non-invoice overpayment', async () => {
    const plainAttempt = { ...attempt, metadata: {} };
    const db = ordersClient({ amount_paid: 30, total: 100 });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt: plainAttempt,
      providerData: { ...providerData, amount: 10000 },
      supabase: db as never,
    });

    // 100 against 70 owing: excess money the finalizer would silently
    // promote to paid, so it owes the duplicate review directly.
    expect(gate).toEqual({ status: 'done' });
    expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({ id: 'attempt-1' }),
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it.each([
    {
      amount: 1000,
      filesShortReview: true,
      name: 'shortfall',
      total: 10.01,
      paid: 0,
    },
    {
      amount: 1001,
      filesShortReview: false,
      name: 'surplus',
      total: 10,
      paid: 0,
    },
  ])('routes a one-kobo $name to review instead of exact completion', async ({
    amount,
    total,
    paid,
    filesShortReview,
  }) => {
    const plainAttempt = { ...attempt, metadata: {} };
    const db = ordersClient({ amount_paid: paid, total });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt: plainAttempt,
      providerData: { ...providerData, amount },
      supabase: db as never,
    });

    // A float tolerance would read both as exact; integer kobo files
    // the shortfall for review and the surplus as a duplicate.
    expect(gate).toEqual({ status: 'done' });
    if (filesShortReview) {
      expect(db.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_type: 'partial_capture_short_requires_review',
        })
      );
      expect(db.rpc).toHaveBeenCalledWith(
        'stamp_abandoned_sweep_resolution_v1',
        expect.objectContaining({
          p_resolution: 'partial_capture_short_reviewed',
        })
      );
      expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
      expect(h.hold).not.toHaveBeenCalled();
      expect(mocks.fileDuplicatePaymentCapture).not.toHaveBeenCalled();
    } else {
      expect(mocks.fileDuplicatePaymentCapture).toHaveBeenCalled();
      expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    }
  });

  it('files a non-invoice underpayment for review instead of holding it', async () => {
    const plainAttempt = { ...attempt, metadata: {} };
    const db = ordersClient({ amount_paid: 30, total: 100 });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt: plainAttempt,
      providerData: { ...providerData, amount: 5000 },
      supabase: db as never,
    });

    // 50 against 70 owing: promoting would trigger full paid side
    // effects, but the verified capture is real money — file it and
    // retire the row instead of rotating the same hold forever.
    expect(gate).toEqual({ status: 'done' });
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'partial_capture_short_requires_review',
        merchant_id: 'merchant-1',
        paystack_ref: 'BAC-OLD',
        txn_id: 'attempt-1',
        metadata: expect.objectContaining({
          capture_amount_minor: 5000,
          outstanding_amount_minor: 7000,
        }),
      })
    );
    expect(db.rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'partial_capture_short_reviewed',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.hold).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(false);
  });

  it('fails when the outstanding balance cannot be read', async () => {
    const plainAttempt = { ...attempt, metadata: {} };
    const db = ordersClient(null, new Error('db down'));
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt: plainAttempt,
      providerData,
      supabase: db as never,
    });

    expect(gate).toEqual({ status: 'done' });
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_balance_unavailable');
  });

  it('fails when the partial-payment RPC errors', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error('db down') });
    const h = harness();

    const gate = await gatePartiallyPaidAbandonedCapture({
      ...h,
      attempt,
      providerData,
      supabase: { from: vi.fn(), rpc } as never,
    });

    expect(gate).toEqual({ status: 'done' });
    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('partial_completion_unavailable');
  });
});
