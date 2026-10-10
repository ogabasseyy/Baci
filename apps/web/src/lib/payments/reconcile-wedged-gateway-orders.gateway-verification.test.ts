import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileWedgedGatewayOrders } from '@/lib/payments/reconcile-wedged-gateway-orders';

const mocks = vi.hoisted(() => ({
  finalizeOrderGatewayPayment: vi.fn(),
  handlePaymentForCancelledOrder: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyPaystackPayment,
}));
vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: mocks.finalizeOrderGatewayPayment,
}));
vi.mock(
  '@/lib/payments/handle-payment-for-cancelled-order',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    handlePaymentForCancelledOrder: mocks.handlePaymentForCancelledOrder,
  })
);

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

function buildSupabase(data: unknown[]) {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'neq',
    'not',
    'lt',
    'is',
    'or',
    'order',
  ]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  // The sweep runs two candidate queries (main, then filing-only
  // retries): the canned rows belong to the main query only.
  builder.limit = vi
    .fn()
    .mockResolvedValueOnce({ data, error: null })
    .mockResolvedValue({ data: [], error: null });
  return {
    from: vi.fn().mockReturnValue(builder),
    rpc,
  } as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };
}

const scheduleAfter = (task: () => Promise<void>) => {
  void task();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
});

describe('reconcileWedgedGatewayOrders gateway verification', () => {
  it('re-verifies with Paystack and heals a wedged order', async () => {
    const supabase = buildSupabase([wedgedCandidate]);
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: true,
      kind: 'completed',
      orderNumber: 'ORD-260711-00NT-5',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(mocks.verifyPaystackPayment).toHaveBeenCalledWith(
      wedgedCandidate.gateway_reference,
      undefined
    );
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'cron:reconcile-gateway-paid-orders',
        orderId: 'order-1',
        wonTransactionFlip: false,
      })
    );
    expect(summary.healed).toEqual([
      { orderId: 'order-1', orderNumber: 'ORD-260711-00NT-5' },
    ]);
  });

  it('files a review and retires a gateway-declined candidate', async () => {
    const supabase = buildSupabase([wedgedCandidate]);
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'abandoned' },
      success: true,
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.skipped).toEqual([
      { reason: 'gateway_status_not_success', transactionId: 'txn-1' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'gateway_verification_negative',
        p_transaction_id: 'txn-1',
      })
    );
  });

  it('keeps retrying when gateway verification is unavailable', async () => {
    const supabase = buildSupabase([wedgedCandidate]);
    mocks.verifyPaystackPayment.mockResolvedValue({
      error: 'network down',
      success: false,
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.skipped).toEqual([
      {
        reason: 'paystack_verification_unavailable',
        transactionId: 'txn-1',
      },
    ]);
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.anything()
    );
  });

  it('skips on gateway/database amount mismatch', async () => {
    const supabase = buildSupabase([wedgedCandidate]);
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 100, currency: 'NGN', status: 'success' },
      success: true,
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.skipped).toEqual([
      { reason: 'amount_mismatch', transactionId: 'txn-1' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('skips on currency mismatch', async () => {
    const supabase = buildSupabase([wedgedCandidate]);
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'USD', status: 'success' },
      success: true,
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.skipped).toEqual([
      { reason: 'currency_mismatch', transactionId: 'txn-1' },
    ]);
  });
});
