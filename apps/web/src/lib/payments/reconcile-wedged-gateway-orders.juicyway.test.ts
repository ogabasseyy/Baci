import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileWedgedGatewayOrders } from '@/lib/payments/reconcile-wedged-gateway-orders';

const mocks = vi.hoisted(() => ({
  finalizeOrderGatewayPayment: vi.fn(),
  getJuicywaySession: vi.fn(),
}));

vi.mock('@/lib/juicyway', () => ({
  getPaymentSession: mocks.getJuicywaySession,
}));
vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: mocks.finalizeOrderGatewayPayment,
}));

const candidate = {
  amount: '58290.60',
  created_at: '2026-07-01T00:00:00.000Z',
  currency: 'NGN',
  gateway: 'juicyway',
  gateway_reference: 'BAC-JUICY',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: {
    juicyway_expected_amount: 50_000,
    juicyway_expected_currency: 'USDT',
    session_id: 'session-1',
  },
  order_id: 'order-1',
  orders: { cancelled_at: null, id: 'order-1', payment_status: 'pending' },
  status: 'pending',
};

function buildSupabase(data: unknown[]) {
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
  } as unknown as SupabaseClient;
}

const scheduleAfter = (task: () => Promise<void>) => {
  void task();
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reconcileWedgedGatewayOrders Juicyway', () => {
  it('re-verifies a succeeded session and finalizes without a webhook', async () => {
    const supabase = buildSupabase([candidate]);
    mocks.getJuicywaySession.mockResolvedValue({
      data: {
        id: 'session-1',
        payment: {
          amount: 50_000,
          currency: 'USDT',
          id: 'payment-1',
          status: 'succeeded',
        },
        status: 'succeeded',
      },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-JUICY',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(mocks.getJuicywaySession).toHaveBeenCalledWith(
      'session-1',
      undefined
    );
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'juicyway',
        orderId: 'order-1',
        reference: 'BAC-JUICY',
        // The pending candidate keeps its fresh-capture signal; a
        // same-transaction replay is distinguished downstream by the
        // outbox payer evidence.
        wonTransactionFlip: true,
      })
    );
    expect(summary.healed).toEqual([
      { orderId: 'order-1', orderNumber: 'ORD-JUICY' },
    ]);
  });

  it('keeps a provider-pending session in the hourly sweep', async () => {
    const supabase = buildSupabase([candidate]);
    mocks.getJuicywaySession.mockResolvedValue({
      data: {
        id: 'session-1',
        payment: {
          amount: 50_000,
          currency: 'USDT',
          id: 'payment-1',
          status: 'processing',
        },
        status: 'processing',
      },
      success: true,
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.skipped).toEqual([
      { reason: 'juicyway_payment_pending', transactionId: 'txn-1' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('re-verifies a legacy session without settlement metadata', async () => {
    const legacyCandidate = {
      ...candidate,
      created_at: '2026-06-25T14:44:59.999Z',
      gateway_reference: 'BAC-JUICY-LEGACY',
      metadata: { session_id: 'legacy-session' },
    };
    const supabase = buildSupabase([legacyCandidate]);
    mocks.getJuicywaySession.mockResolvedValue({
      data: {
        id: 'legacy-session',
        payment: {
          amount: 50_000,
          currency: 'USDT',
          id: 'legacy-payment',
          status: 'succeeded',
        },
        status: 'succeeded',
      },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-JUICY-LEGACY',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(mocks.getJuicywaySession).toHaveBeenCalledWith(
      'legacy-session',
      undefined
    );
    expect(summary.healed).toEqual([
      { orderId: 'order-1', orderNumber: 'ORD-JUICY-LEGACY' },
    ]);
  });
});
