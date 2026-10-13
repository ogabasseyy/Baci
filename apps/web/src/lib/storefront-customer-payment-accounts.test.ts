import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadStorefrontCustomerPaymentAccounts } from './storefront-customer-payment-accounts';

describe('loadStorefrontCustomerPaymentAccounts', () => {
  it('loads the customer-safe payment-account projection', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          account_name: 'Automatic confirmation',
          account_number: '1234567890',
          assigned_at: '2026-08-27T12:00:00.000Z',
          assignment_customer_email_source: 'assignment',
          bank_name: 'Paystack-Titan',
          created_at: '2026-08-27T12:00:00.000Z',
          expires_at: '2026-08-27T13:30:00.000Z',
          order_id: 'order-1',
          provider: 'paystack',
        },
      ],
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(
      loadStorefrontCustomerPaymentAccounts(supabase, ['order-1'])
    ).resolves.toEqual({
      data: [
        {
          account_name: 'Automatic confirmation',
          account_number: '1234567890',
          assigned_at: '2026-08-27T12:00:00.000Z',
          assignment_customer_email_source: 'assignment',
          bank_name: 'Paystack-Titan',
          created_at: '2026-08-27T12:00:00.000Z',
          expires_at: '2026-08-27T13:30:00.000Z',
          order_id: 'order-1',
          provider: 'paystack',
        },
      ],
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith('get_customer_order_payment_accounts', {
      p_order_ids: ['order-1'],
    });
  });

  it('does not query when there are no orders', async () => {
    const rpc = vi.fn();
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(
      loadStorefrontCustomerPaymentAccounts(supabase, [])
    ).resolves.toEqual({ data: [], error: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns RPC errors without hiding the partial projection', async () => {
    const error = new Error('payment-account lookup unavailable');
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    const supabase = { rpc } as unknown as SupabaseClient;

    const result = await loadStorefrontCustomerPaymentAccounts(supabase, [
      'order-1',
    ]);

    expect(result.error).toBe(error);
    expect(result.data).toEqual([]);
  });
});
