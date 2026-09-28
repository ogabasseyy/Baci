import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileWedgedGatewayOrders } from '@/lib/payments/reconcile-wedged-gateway-orders';

const mocks = vi.hoisted(() => ({
  finalizeOrderGatewayPayment: vi.fn(),
  getJuicywaySession: vi.fn(),
  handlePaymentForCancelledOrder: vi.fn(),
  verifyKorapayPayment: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/lib/juicyway', () => ({
  getPaymentSession: mocks.getJuicywaySession,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyPaystackPayment,
}));
vi.mock('@/lib/korapay', () => ({
  verifyPayment: mocks.verifyKorapayPayment,
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

function buildSupabase(result: { data?: unknown[]; error?: unknown }) {
  const stampUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const builder: Record<string, unknown> = {
    update: stampUpdate,
  };
  const select = vi.fn().mockReturnValue(builder);
  builder.select = select;
  for (const method of ['eq', 'neq', 'not', 'lt', 'is', 'or', 'order']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  // `.limit()` is the terminal call in the sweep's candidate query chain;
  // resolution stamps go through `.update().eq()` on the same builder.
  builder.limit = vi
    .fn()
    .mockResolvedValue({ data: null, error: null, ...result });
  return {
    from: vi.fn().mockReturnValue(builder),
    select,
    stampUpdate,
  } as unknown as SupabaseClient & {
    select: ReturnType<typeof vi.fn>;
    stampUpdate: ReturnType<typeof vi.fn>;
  };
}

const scheduleAfter = (task: () => Promise<void>) => {
  void task();
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reviews file durably by default; the stamp is gated on this.
  mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
});

describe('reconcileWedgedGatewayOrders', () => {
  it('throws when the wedged-candidate lookup fails', async () => {
    const supabase = buildSupabase({ error: { message: 'db down' } });

    await expect(
      reconcileWedgedGatewayOrders({ scheduleAfter, supabase })
    ).rejects.toThrow('wedged_order_lookup_failed');
  });

  it('returns an empty summary when nothing is wedged', async () => {
    const supabase = buildSupabase({ data: [] });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary).toEqual({
      checked: 0,
      detectedUnhealable: [],
      failed: [],
      healed: [],
      reviewsFiled: [],
      skipped: [],
    });
  });

  it('disambiguates the order relationship while preserving healable candidates', async () => {
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

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(supabase.select).toHaveBeenCalledWith(
      'id, created_at, order_id, merchant_id, amount, currency, platform_fee, gateway, gateway_reference, metadata, status, orders!transactions_order_id_fkey!inner(id, payment_status, cancelled_at)'
    );
    expect(summary).toMatchObject({
      checked: 1,
      healed: [{ orderId: 'order-1', orderNumber: 'ORD-1' }],
    });
  });

  it('admits provider-flagged pending rows and heals them after re-verification', async () => {
    // A guest Paystack payment the verify GET confirmed with the
    // provider but whose webhook never landed: pending, flagged, order
    // unpaid. The sweep must pick it up (not only pending Juicyway)
    // and heal once its own re-verification agrees.
    const supabase = buildSupabase({
      data: [
        {
          ...wedgedCandidate,
          metadata: { guest_provider_confirmed: true },
          status: 'pending',
        },
      ],
    });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: true,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    const builder = vi.mocked(supabase.from).mock.results[0]?.value as {
      or: ReturnType<typeof vi.fn>;
    };
    expect(builder.or).toHaveBeenCalledWith(
      'status.eq.completed,and(status.eq.pending,gateway.eq.juicyway),and(status.eq.pending,metadata->>guest_provider_confirmed.eq.true)'
    );
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ wonTransactionFlip: true })
    );
    expect(summary).toMatchObject({
      checked: 1,
      healed: [{ orderId: 'order-1', orderNumber: 'ORD-1' }],
    });
  });

  it('surfaces unhealable gateways loudly instead of guessing', async () => {
    const supabase = buildSupabase({
      data: [{ ...wedgedCandidate, gateway: 'klump' }],
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.detectedUnhealable).toEqual([
      { gateway: 'klump', transactionId: 'txn-1' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
    // Logged once, stamped so it never consumes the hourly batch again.
    expect(supabase.stampUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          wedge_sweep_resolution: 'unhealable_gateway_logged',
        }),
      })
    );
  });

  it('files the review and stamps a wedged payment whose order was cancelled', async () => {
    const cancelledCandidate = {
      ...wedgedCandidate,
      orders: {
        cancelled_at: '2026-07-12T00:00:00Z',
        id: 'order-1',
        payment_status: 'cancelled',
      },
    };
    const supabase = buildSupabase({ data: [cancelledCandidate] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      kind: 'order_cancelled',
      orderNumber: 'ORD-1',
    });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.reviewsFiled).toEqual([
      { orderId: 'order-1', transactionId: 'txn-1' },
    ]);
    expect(supabase.stampUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          wedge_sweep_resolution: 'order_cancelled',
        }),
      })
    );
  });

  it('does not retire a wedged row when its review cannot be filed', async () => {
    const supabase = buildSupabase({
      data: [{ ...wedgedCandidate, gateway: 'klump' }],
    });
    mocks.handlePaymentForCancelledOrder.mockResolvedValue(false);

    await reconcileWedgedGatewayOrders({ scheduleAfter, supabase });

    // Without a durable ops row the payment must stay visible to the sweep.
    expect(supabase.stampUpdate).not.toHaveBeenCalled();
  });

  it('records finalizer failures without aborting the run', async () => {
    const second = {
      ...wedgedCandidate,
      gateway: 'korapay',
      gateway_reference: 'BAC-KORA',
      id: 'txn-2',
      order_id: 'order-2',
    };
    const supabase = buildSupabase({ data: [wedgedCandidate, second] });
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { amount: 5829060, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.verifyKorapayPayment.mockResolvedValue({
      data: { amount: 58290.6, currency: 'NGN', status: 'success' },
      success: true,
    });
    mocks.finalizeOrderGatewayPayment
      .mockResolvedValueOnce({ error: 'x', kind: 'completion_failed' })
      .mockResolvedValueOnce({
        healed: true,
        kind: 'completed',
        orderNumber: 'ORD-2',
      });

    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });

    expect(summary.failed).toEqual([
      { reason: 'completion_failed', transactionId: 'txn-1' },
    ]);
    expect(summary.healed).toEqual([
      { orderId: 'order-2', orderNumber: 'ORD-2' },
    ]);
    expect(summary.checked).toBe(2);
  });
});
