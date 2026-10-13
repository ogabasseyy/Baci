import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadStorefrontCustomerTransactions } from './storefront-customer-transactions';

describe('loadStorefrontCustomerTransactions', () => {
  it('loads a customer-safe projection and reconstructs only the DVA metadata needed by receipt selection', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'transaction-1',
          order_id: 'order-1',
          amount: 1000,
          created_at: '2026-08-27T12:00:00.000Z',
          description: 'Paystack transfer',
          gateway: 'paystack',
          status: 'completed',
          transaction_type: 'payment',
          dva_account_number: '1234567890',
        },
      ],
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    const result = await loadStorefrontCustomerTransactions(supabase, [
      'order-1',
    ]);

    expect(rpc).toHaveBeenCalledWith('get_customer_order_transactions', {
      p_order_ids: ['order-1'],
    });
    expect(result.data).toEqual([
      {
        id: 'transaction-1',
        order_id: 'order-1',
        amount: 1000,
        created_at: '2026-08-27T12:00:00.000Z',
        description: 'Paystack transfer',
        metadata: { dva_account_number: '1234567890' },
        gateway: 'paystack',
        status: 'completed',
        transaction_type: 'payment',
      },
    ]);
  });

  it('does not issue a broad transaction query when there are no paid orders', async () => {
    const rpc = vi.fn();
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(
      loadStorefrontCustomerTransactions(supabase, [])
    ).resolves.toEqual({ data: [], error: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns RPC errors without hiding them from the caller', async () => {
    const error = new Error('customer transaction lookup failed');
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    const supabase = { rpc } as unknown as SupabaseClient;

    const result = await loadStorefrontCustomerTransactions(supabase, [
      'order-1',
    ]);

    expect(result.error).toBe(error);
    expect(result.data).toEqual([]);
  });
});
