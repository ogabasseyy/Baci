import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileWedgedGatewayOrders } from '@/lib/payments/reconcile-wedged-gateway-orders';

const mocks = vi.hoisted(() => ({
  finalizeOrderGatewayPayment: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyPaystackPayment,
}));
vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: mocks.finalizeOrderGatewayPayment,
}));

const wedgedCandidate = {
  amount: '58290.60',
  created_at: '2026-07-01T00:00:00.000Z',
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: '100004260711172450165090811595',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: null,
  order_id: 'order-1',
  orders: { cancelled_at: null, id: 'order-1', payment_status: 'pending' },
  status: 'completed',
};

function buildSupabase(result: { data?: unknown[]; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  const select = vi.fn().mockReturnValue(builder);
  builder.select = select;
  for (const method of ['eq', 'neq', 'not', 'lt', 'is', 'or', 'order']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.limit = vi
    .fn()
    .mockResolvedValue({ data: null, error: null, ...result });
  return {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient;
}

const scheduleAfter = (task: () => Promise<void>) => {
  void task();
};

describe('reconcileWedgedGatewayOrders pass deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops starting candidates at the pass deadline', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_180_000);

    try {
      const summary = await reconcileWedgedGatewayOrders({
        deadlineMs: 1_180_000,
        scheduleAfter,
        supabase,
      });

      expect(summary.checked).toBe(0);
      expect(mocks.verifyPaystackPayment).not.toHaveBeenCalled();
      expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('declines to start finalize without sufficient reserve', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_170_000);

    try {
      const summary = await reconcileWedgedGatewayOrders({
        deadlineMs: 1_180_000,
        scheduleAfter,
        supabase,
      });

      // Verification succeeded 10s before the deadline: starting finalize
      // would spend the paid-email retry budget past it and starve the
      // failed-side-effect pass. The unstamped row retries next sweep.
      expect(mocks.verifyPaystackPayment).toHaveBeenCalled();
      expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
      expect(summary).toMatchObject({
        checked: 1,
        failed: [],
        healed: [],
        skipped: [],
      });
    } finally {
      now.mockRestore();
    }
  });

  it('forwards the remaining deadline to the finalizer', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: true,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_100_000);

    try {
      const summary = await reconcileWedgedGatewayOrders({
        deadlineMs: 1_180_000,
        scheduleAfter,
        supabase,
      });

      expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(summary.healed).toEqual([
        { orderId: 'order-1', orderNumber: 'ORD-1' },
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it('stops waiting for an overrunning finalize at the pass deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_100_000);
      const supabase = buildSupabase({ data: [wedgedCandidate] });
      mocks.verifyPaystackPayment.mockResolvedValue({
        data: { amount: 5829060, currency: 'NGN', status: 'success' },
        success: true,
      });
      mocks.finalizeOrderGatewayPayment.mockReturnValue(
        new Promise(() => {
          // Never settles: the sweep must stop waiting at the deadline
          // instead of reaching the route limit with claimed work in flight.
        })
      );

      const pending = reconcileWedgedGatewayOrders({
        deadlineMs: 1_121_000,
        scheduleAfter,
        supabase,
      });
      await vi.advanceTimersByTimeAsync(11_000);
      const summary = await pending;

      expect(summary.failed).toEqual([
        {
          reason: 'refund_notification_delivery_deadline',
          transactionId: 'txn-1',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds in-flight verification to the remaining pass share', async () => {
    const supabase = buildSupabase({ data: [wedgedCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      code: 'NETWORK_ERROR',
      error: 'socket hangup',
      success: false,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_100_000);

    try {
      const summary = await reconcileWedgedGatewayOrders({
        deadlineMs: 1_180_000,
        scheduleAfter,
        supabase,
      });

      expect(mocks.verifyPaystackPayment).toHaveBeenCalledWith(
        wedgedCandidate.gateway_reference,
        expect.any(AbortSignal)
      );
      expect(summary.skipped).toEqual([
        {
          reason: 'paystack_verification_unavailable',
          transactionId: 'txn-1',
        },
      ]);
    } finally {
      now.mockRestore();
    }
  });
});
