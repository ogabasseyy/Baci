import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { recordCreditDirectTransaction } from './record-credit-direct-transaction';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

describe('recordCreditDirectTransaction', () => {
  it('loads the transaction ID after a concurrent insert wins', async () => {
    const selectResults = [
      { data: null, error: null },
      {
        data: {
          id: 'winning-transaction',
          merchant_id: 'merchant',
          order_id: 'order',
        },
        error: null,
      },
    ];
    const select = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const single = vi
      .fn()
      .mockImplementation(() => Promise.resolve(selectResults.shift()));
    const insertSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505' } });
    const from = vi.fn(() => ({
      select,
      eq,
      maybeSingle: single,
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: insertSingle }),
      }),
    }));
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      recordCreditDirectTransaction({
        amount: 150,
        gatewayReference: 'provider-reference',
        gatewayResponse: {
          checkoutCustomer: { firstName: 'Test', lastName: 'Customer' },
          checkoutTransactionId: 'provider-reference',
          eventType: 'Checkout_Merchant_Payment_Completed',
          metaData: null,
          products: [],
          timeStamp: new Date(0).toISOString(),
        },
        merchantId: 'merchant',
        merchantAmount: 145,
        orderId: 'order',
        platformFee: 5,
        supabase,
      })
    ).resolves.toEqual({
      created: false,
      kind: 'recorded',
      transactionId: 'winning-transaction',
    });
    expect(from).toHaveBeenCalledTimes(3);
    expect(eq).toHaveBeenCalledWith('gateway_reference', 'provider-reference');
    expect(eq).toHaveBeenCalledWith('gateway', 'credit_direct');
    expect(eq).toHaveBeenCalledWith('merchant_id', 'merchant');
  });

  it('fails closed when the provider reference belongs to another order', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'other-order-transaction',
        merchant_id: 'merchant',
        order_id: 'another-order',
      },
      error: null,
    });
    const insert = vi.fn();
    const from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: single,
      insert,
    }));

    await expect(
      recordCreditDirectTransaction({
        amount: 150,
        gatewayReference: 'provider-reference',
        gatewayResponse: {
          checkoutCustomer: { firstName: 'Test', lastName: 'Customer' },
          checkoutTransactionId: 'provider-reference',
          eventType: 'Checkout_Merchant_Payment_Completed',
          metaData: null,
          products: [],
          timeStamp: new Date(0).toISOString(),
        },
        merchantId: 'merchant',
        merchantAmount: 145,
        orderId: 'order',
        platformFee: 5,
        supabase: { from } as unknown as SupabaseClient,
      })
    ).resolves.toEqual({ kind: 'error' });
    expect(insert).not.toHaveBeenCalled();
  });
});
