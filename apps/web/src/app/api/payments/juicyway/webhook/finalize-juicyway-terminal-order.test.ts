import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { finalizeJuicywayTerminalOrder } from './finalize-juicyway-terminal-order';

vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: vi.fn(),
}));

function mockSupabase(data: unknown, error: unknown = null) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
  };
  return { from: vi.fn().mockReturnValue(query), query };
}

const transaction = {
  amount: 150,
  gateway_reference: 'reference',
  id: 'transaction',
  merchant_id: 'merchant',
  order_id: 'order',
  platform_fee: 5,
};

describe('finalizeJuicywayTerminalOrder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a cancelled order through the shared winning finalizer', async () => {
    vi.mocked(finalizeOrderGatewayPayment).mockResolvedValue({
      kind: 'completed',
      orderNumber: 'ORD-1',
      healed: false,
    });
    const supabase = mockSupabase({
      id: 'order',
      order_number: 'ORD-1',
      payment_status: 'cancelled',
      shipping_status: 'cancelled',
      cancelled_at: '2026-01-01T00:00:00Z',
    });
    const scheduleAfter = vi.fn();

    await expect(
      finalizeJuicywayTerminalOrder({
        gatewayResponse: { status: 'success' },
        orderId: 'order',
        reference: 'reference',
        scheduleAfter,
        supabase: supabase as unknown as SupabaseClient,
        transaction,
      })
    ).resolves.toEqual({ kind: 'completed' });
    expect(supabase.query.eq).toHaveBeenCalledWith(
      'merchant_id',
      transaction.merchant_id
    );
    expect(finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'juicyway:late_payment',
        orderId: 'order',
        wonTransactionFlip: false,
      })
    );
  });

  it('attempts reinstatement for the alternate canceled spelling', async () => {
    vi.mocked(finalizeOrderGatewayPayment).mockResolvedValue({
      kind: 'completed',
      orderNumber: 'ORD-1',
      healed: false,
    });
    const supabase = mockSupabase({
      id: 'order',
      order_number: 'ORD-1',
      payment_status: 'canceled',
      shipping_status: 'pending',
      cancelled_at: null,
    });

    await expect(
      finalizeJuicywayTerminalOrder({
        gatewayResponse: { status: 'success' },
        orderId: 'order',
        reference: 'reference',
        scheduleAfter: vi.fn(),
        supabase: supabase as unknown as SupabaseClient,
        transaction,
      })
    ).resolves.toEqual({ kind: 'completed' });
    expect(finalizeOrderGatewayPayment).toHaveBeenCalledOnce();
  });

  it('returns the non-cancelled row for the existing terminal review flow', async () => {
    const order = {
      id: 'order',
      order_number: 'ORD-1',
      payment_status: 'paid',
      shipping_status: 'processing',
      cancelled_at: null,
    };
    const supabase = mockSupabase(order);

    await expect(
      finalizeJuicywayTerminalOrder({
        gatewayResponse: { status: 'success' },
        orderId: 'order',
        reference: 'reference',
        scheduleAfter: vi.fn(),
        supabase: supabase as unknown as SupabaseClient,
        transaction,
      })
    ).resolves.toEqual({ kind: 'not_cancelled', order });
    expect(finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('returns legacy cancelled captures for review without reinstating them', async () => {
    const order = {
      id: 'order',
      order_number: 'ORD-1',
      payment_status: 'cancelled',
      shipping_status: 'cancelled',
      cancelled_at: '2026-01-01T00:00:00Z',
    };
    const supabase = mockSupabase(order);

    await expect(
      finalizeJuicywayTerminalOrder({
        allowReinstatement: false,
        gatewayResponse: { status: 'success' },
        orderId: 'order',
        reference: 'reference',
        scheduleAfter: vi.fn(),
        supabase: supabase as unknown as SupabaseClient,
        transaction,
      })
    ).resolves.toEqual({ kind: 'not_cancelled', order });
    expect(finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('fails closed when terminal order state cannot be loaded', async () => {
    const supabase = mockSupabase(null, { message: 'Unavailable' });

    await expect(
      finalizeJuicywayTerminalOrder({
        gatewayResponse: { status: 'success' },
        orderId: 'order',
        reference: 'reference',
        scheduleAfter: vi.fn(),
        supabase: supabase as unknown as SupabaseClient,
        transaction,
      })
    ).resolves.toEqual({ kind: 'failed', stage: 'lookup' });
  });
});
