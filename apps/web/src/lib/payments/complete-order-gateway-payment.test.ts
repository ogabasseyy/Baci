import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { completeOrderGatewayPayment } from '@/lib/payments/complete-order-gateway-payment';

const refreshReclaimedOrderInventory = vi.hoisted(() => vi.fn());
vi.mock('./ensure-paid-order-inventory-confirmed', () => ({
  refreshReclaimedOrderInventory,
}));

function buildSupabaseMock(rpcResult: {
  data?: unknown;
  error?: { message: string } | null;
}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null, ...rpcResult }),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          amount_paid: 4200,
          paid_at: '2026-11-23T11:00:00Z',
          paid_transaction_id: 'txn-1',
        },
        error: null,
      }),
    })),
  } as unknown as SupabaseClient;
}

describe('completeOrderGatewayPayment', () => {
  const completionPayload = {
    actor: 'cron:reconcile-gateway-paid-orders',
    already_completed: true,
    cancelled_at: null,
    order_already_paid: false,
    order_cancelled: false,
    order_number: 'ORD-1',
    order_skipped_status: null,
    order_updated: true,
    payment_status: 'paid',
    previous_payment_status: 'pending',
    previous_shipping_status: 'pending',
    shipping_status: 'processing',
  };

  it('invokes the atomic RPC with the exact parameter names', async () => {
    const supabase = buildSupabaseMock({ data: completionPayload });

    await completeOrderGatewayPayment({
      actor: 'webhook:BAC-REF',
      gatewayResponse: { status: 'success' },
      orderId: 'order-1',
      supabase,
      transactionId: 'txn-1',
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      {
        p_actor: 'webhook:BAC-REF',
        p_expected_outstanding_minor: null,
        p_gateway_response: { status: 'success' },
        p_order_id: 'order-1',
        p_transaction_id: 'txn-1',
      }
    );
  });

  it('forwards the gated outstanding balance for the compare-and-swap', async () => {
    const supabase = buildSupabaseMock({ data: completionPayload });

    await completeOrderGatewayPayment({
      actor: 'cron:reconcile-gateway-paid-orders',
      expectedOutstandingMinor: 7000,
      gatewayResponse: null,
      orderId: 'order-1',
      supabase,
      transactionId: 'txn-1',
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.objectContaining({ p_expected_outstanding_minor: 7000 })
    );
  });

  it('returns the parsed completion on success', async () => {
    const supabase = buildSupabaseMock({
      data: completionPayload,
    });

    const result = await completeOrderGatewayPayment({
      actor: 'cron:reconcile-gateway-paid-orders',
      gatewayResponse: null,
      orderId: 'order-1',
      supabase,
      transactionId: 'txn-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.completion.already_completed).toBe(true);
      expect(result.completion.order_updated).toBe(true);
    }
  });

  it.each([
    ['reinstated', true, false],
    ['reinstated_inventory_reclaimed', true, true],
    ['already_reinstated', false, false],
  ] as const)('reports a %s timeout payment as paid', async (state, updated, reclaimed) => {
    refreshReclaimedOrderInventory.mockClear();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          ...completionPayload,
          cancelled_at: '2026-11-15T00:00:00Z',
          order_cancelled: true,
          order_updated: false,
          payment_status: 'cancelled',
          shipping_status: 'cancelled',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: state, error: null });
    const supabase = {
      rpc,
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            amount_paid: 4200,
            paid_at: '2026-11-23T11:00:00Z',
            paid_transaction_id: 'txn-1',
          },
          error: null,
        }),
      })),
    } as unknown as SupabaseClient;

    const result = await completeOrderGatewayPayment({
      actor: 'webhook:BAC-REF',
      gatewayResponse: { status: 'success' },
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase,
      transactionId: 'txn-1',
    });

    if (reclaimed) {
      expect(refreshReclaimedOrderInventory).toHaveBeenCalledExactlyOnceWith(
        supabase,
        'merchant-1',
        'order-1'
      );
    } else {
      expect(refreshReclaimedOrderInventory).not.toHaveBeenCalled();
    }
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'reinstate_timeout_order_payment',
      { p_order_id: 'order-1', p_transaction_id: 'txn-1' }
    );
    expect(result).toMatchObject({
      ok: true,
      completion: {
        amount_paid: 4200,
        cancelled_at: null,
        order_cancelled: false,
        order_updated: updated,
        paid_at: '2026-11-23T11:00:00Z',
        paid_transaction_id: 'txn-1',
        payment_status: 'paid',
        shipping_status: 'processing',
        timeout_inventory_confirmed: true,
      },
    });
  });

  it('returns an error for a cancelled payment without a merchant identity', async () => {
    const supabase = buildSupabaseMock({
      data: { ...completionPayload, order_cancelled: true },
    });
    const result = await completeOrderGatewayPayment({
      actor: 'webhook:BAC-REF',
      gatewayResponse: { status: 'success' },
      orderId: 'order-1',
      supabase,
      transactionId: 'txn-1',
    });
    expect(result).toMatchObject({ ok: false });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the RPC itself errors', async () => {
    const supabase = buildSupabaseMock({
      data: null,
      error: { message: 'permission denied' },
    });

    const result = await completeOrderGatewayPayment({
      actor: 'webhook:BAC-REF',
      gatewayResponse: null,
      orderId: 'order-1',
      supabase,
      transactionId: 'txn-1',
    });

    expect(result.ok).toBe(false);
  });

  it('fails closed when the RPC payload does not match the schema', async () => {
    const supabase = buildSupabaseMock({
      data: { order_updated: 'definitely' },
    });

    const result = await completeOrderGatewayPayment({
      actor: 'webhook:BAC-REF',
      gatewayResponse: null,
      orderId: 'order-1',
      supabase,
      transactionId: 'txn-1',
    });

    expect(result.ok).toBe(false);
  });

  it('fails closed when the RPC returns an empty object', async () => {
    const result = await completeOrderGatewayPayment({
      actor: 'webhook:BAC-REF',
      gatewayResponse: null,
      orderId: 'order-1',
      supabase: buildSupabaseMock({ data: {} }),
      transactionId: 'txn-1',
    });

    expect(result.ok).toBe(false);
  });
});
