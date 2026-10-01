import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolveStorefrontOrderPaymentAccounts } from './storefront-order-payment-accounts';

const accounts = [
  {
    account_name: 'Paid DVA',
    account_number: '1111111111',
    bank_name: 'Paystack',
    created_at: '2026-07-08T11:00:00.000Z',
    expires_at: '2026-07-08T12:30:00.000Z',
    provider: 'paystack',
  },
  {
    account_name: 'Newer DVA',
    account_number: '2222222222',
    bank_name: 'Paystack',
    created_at: '2026-07-08T12:00:00.000Z',
    expires_at: '2026-07-08T13:30:00.000Z',
    provider: 'paystack',
  },
];

describe('resolveStorefrontOrderPaymentAccounts', () => {
  it('uses the paid transaction receiver for a historical alias', async () => {
    const rpc = vi.fn((fn: string) => {
      if (fn === 'get_customer_order_payment_accounts') {
        return Promise.resolve({
          data: accounts.map((account) => ({
            ...account,
            order_id: 'order-1',
          })),
          error: null,
        });
      }
      return Promise.resolve({
        data: [
          {
            amount: 1000,
            created_at: '2026-07-08T12:45:00.000Z',
            description: 'Paystack transfer',
            dva_account_number: '1111111111',
            gateway: 'paystack',
            id: 'transaction-1',
            order_id: 'order-1',
            status: 'completed',
            transaction_type: 'payment',
          },
        ],
        error: null,
      });
    });
    const supabase = {
      rpc,
    } as unknown as SupabaseClient;

    const result = await resolveStorefrontOrderPaymentAccounts(
      supabase,
      [
        {
          id: 'order-1',
          order_payment_accounts: accounts,
          payment_status: 'paid',
        },
      ],
      new Date('2026-07-08T13:00:00.000Z')
    );

    expect(result.paymentAccountsByOrderId.get('order-1')?.account_number).toBe(
      '1111111111'
    );
    expect(rpc).toHaveBeenCalledWith('get_customer_order_transactions', {
      p_order_ids: ['order-1'],
    });
    expect(rpc).toHaveBeenCalledWith('get_customer_order_payment_accounts', {
      p_order_ids: ['order-1'],
    });
  });

  it('returns transaction lookup errors while preserving account resolution', async () => {
    const error = new Error('transaction lookup unavailable');
    const rpc = vi.fn((fn: string) => {
      if (fn === 'get_customer_order_payment_accounts') {
        return Promise.resolve({
          data: accounts.map((account) => ({
            ...account,
            order_id: 'order-1',
          })),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error });
    });
    const supabase = {
      rpc,
    } as unknown as SupabaseClient;

    const result = await resolveStorefrontOrderPaymentAccounts(
      supabase,
      [
        {
          id: 'order-1',
          order_payment_accounts: accounts,
          payment_status: 'paid',
        },
      ],
      new Date('2026-07-08T13:00:00.000Z')
    );

    expect(result.transactionError).toBe(error);
    expect(result.paymentAccountsByOrderId.get('order-1')?.account_number).toBe(
      '2222222222'
    );
  });
});
