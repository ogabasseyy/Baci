import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionlessPaymentReferenceSnapshot } from './sessionless-payment-reference-snapshot';

function bearerClient(rpc: ReturnType<typeof vi.fn>) {
  return { rpc: rpc as unknown as SupabaseClient['rpc'] };
}

function snapshotRow() {
  return {
    transaction_id: 'txn-7',
    order_id: 'order-7',
    merchant_id: 'merchant-7',
    amount: 5000,
    currency: 'NGN',
    transaction_status: 'completed',
    gateway: 'paystack',
    gateway_reference: 'BAC-VERIFY-7',
    order_number: 'ORD-7',
    order_payment_status: 'paid',
    order_shipping_status: 'pending',
    order_total: 5000,
    inventory_confirmed: true,
  };
}

describe('getSessionlessPaymentReferenceSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the verification row for a caller-owned reference', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [snapshotRow()], error: null });

    const snapshot = await getSessionlessPaymentReferenceSnapshot(
      bearerClient(rpc),
      'BAC-VERIFY-7'
    );

    expect(rpc).toHaveBeenCalledWith(
      'get_sessionless_payment_reference_snapshot',
      { p_gateway_reference: 'BAC-VERIFY-7' }
    );
    expect(snapshot).toMatchObject({
      orderId: 'order-7',
      orderPaymentStatus: 'paid',
      inventoryConfirmed: true,
    });
  });

  it('returns null on zero rows (foreign or bogus reference)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await expect(
      getSessionlessPaymentReferenceSnapshot(bearerClient(rpc), 'BAC-NOPE')
    ).resolves.toBeNull();
  });

  it('returns null when the RPC errors', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'denied' } });

    await expect(
      getSessionlessPaymentReferenceSnapshot(bearerClient(rpc), 'BAC-VERIFY-7')
    ).resolves.toBeNull();
  });

  it('returns null when the row shape is invalid', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ nope: true }], error: null });

    await expect(
      getSessionlessPaymentReferenceSnapshot(bearerClient(rpc), 'BAC-VERIFY-7')
    ).resolves.toBeNull();
  });
});
