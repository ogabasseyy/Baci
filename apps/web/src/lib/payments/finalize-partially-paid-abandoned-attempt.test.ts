import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalize = vi.hoisted(() => vi.fn());
vi.mock('./finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: finalize,
}));

import { finalizePartiallyPaidAbandonedAttempt } from './finalize-partially-paid-abandoned-attempt';

const attempt = {
  amount: 100,
  gateway_reference: 'BAC-OLD',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  platform_fee: 2,
};

function harness() {
  return {
    hold: vi.fn().mockResolvedValue(undefined),
    scheduleAfter: vi.fn(),
    summary: {
      completed: [] as string[],
      failed: false,
      reviewsFiled: [] as string[],
    },
    supabase: {} as never,
  };
}

describe('finalizePartiallyPaidAbandonedAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a completed order without claiming the transaction flip', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: { reference: 'BAC-OLD' },
    });

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'cron:reconcile-gateway-paid-orders',
        gateway: 'paystack',
        orderId: 'order-1',
        reference: 'BAC-OLD',
        wonTransactionFlip: false,
      })
    );
    expect(h.summary.completed).toEqual(['attempt-1']);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('records a review when the finalizer reports a cancelled order', async () => {
    const h = harness();
    finalize.mockResolvedValue({ kind: 'order_cancelled' });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
  });

  it('holds quietly when the row moved concurrently', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      error: { error_code: 'TRANSACTION_IN_UNEXPECTED_STATE' },
      kind: 'completion_failed',
    });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    expect(h.hold).toHaveBeenCalledWith('changed_concurrently');
    expect(h.summary.failed).toBe(false);
  });

  it('fails the sweep when order completion errors', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      error: new Error('completion unavailable'),
      kind: 'completion_failed',
    });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('completion_failed');
  });
});
