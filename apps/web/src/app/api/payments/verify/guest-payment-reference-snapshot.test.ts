import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGuestPaymentReferenceSnapshot } from './guest-payment-reference-snapshot';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mockRpc }),
}));

describe('getGuestPaymentReferenceSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a well-formed snapshot row', async () => {
    mockRpc.mockResolvedValue({
      error: null,
      data: [
        {
          transaction_id: 'txn-1',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          gateway_reference: 'BAC-REF-1',
          amount: 5000,
          currency: 'NGN',
          transaction_status: 'completed',
          gateway: 'paystack',
          order_number: 'BAC-001',
          order_payment_status: 'paid',
          order_total: 5000,
          inventory_confirmed: true,
        },
      ],
    });

    const snapshot = await getGuestPaymentReferenceSnapshot(
      'BAC-REF-1',
      'tok-1'
    );

    expect(snapshot).toMatchObject({
      transactionId: 'txn-1',
      orderId: 'order-1',
      inventoryConfirmed: true,
    });
  });

  it('fails closed on errors, empty rows, and malformed rows', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'db down' }, data: null });
    await expect(
      getGuestPaymentReferenceSnapshot('BAC-REF-1', 'tok-1')
    ).resolves.toBeNull();

    mockRpc.mockResolvedValue({ error: null, data: [] });
    await expect(
      getGuestPaymentReferenceSnapshot('BAC-REF-1', 'tok-1')
    ).resolves.toBeNull();

    mockRpc.mockResolvedValue({
      error: null,
      data: [{ order_id: 'order-1' }],
    });
    await expect(
      getGuestPaymentReferenceSnapshot('BAC-REF-1', 'tok-1')
    ).resolves.toBeNull();
  });
});
