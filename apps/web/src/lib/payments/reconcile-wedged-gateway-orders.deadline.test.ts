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
