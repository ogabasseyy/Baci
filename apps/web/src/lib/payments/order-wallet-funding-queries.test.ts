import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  createQueryResult,
  createTableSupabaseMock,
} from '@/lib/order-wallet-funding-intent-repository.test-utils';
import {
  fetchOrderPaymentTransaction,
  fetchOrderPaymentTransactionByOrder,
  fetchPaidOrder,
  WALLET_ORDER_GATEWAY_PREFIX,
} from '@/lib/payments/order-wallet-funding-queries';

function asSupabaseClient(client: unknown) {
  return client as SupabaseClient;
}

describe('order wallet funding payment queries', () => {
  it('fetches the paid order row used for order side effects', async () => {
    const orderRow = {
      discount_amount: 0,
      gift_wrapping_fee: 0,
      id: 'order-1',
      merchant_id: 'merchant-1',
      payment_status: 'paid',
      shipping_fee: 0,
      shipping_funding_source: 'merchant_wallet',
      shipping_platform_retained_amount: '1250.50',
      shipping_provider: 'GIGL',
      subtotal: 20_000,
      tax_amount: 0,
      tax_basis: null,
      total: 20_000,
    };
    const orderQuery = createQueryResult({ data: orderRow });
    const supabase = createTableSupabaseMock({ orders: [orderQuery] });

    await expect(
      fetchPaidOrder({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).resolves.toMatchObject({
      id: 'order-1',
      shipping_funding_source: 'merchant_wallet',
      shipping_platform_retained_amount: 1250.5,
      shipping_provider: 'GIGL',
    });
    expect(orderQuery.select).toHaveBeenCalledWith(
      expect.stringContaining(
        'shipping_provider, shipping_funding_source, shipping_platform_retained_amount'
      )
    );
    expect(orderQuery.eq).toHaveBeenCalledWith('id', 'order-1');
    expect(orderQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(orderQuery.eq).toHaveBeenCalledWith('payment_status', 'paid');
  });

  it('rejects malformed paid order rows before side effects run', async () => {
    const supabase = createTableSupabaseMock({
      orders: [createQueryResult({ data: { id: 'order-1' } })],
    });

    await expect(
      fetchPaidOrder({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        supabase: asSupabaseClient(supabase.client),
      })
      // subtotal is now tolerated as 0 for legacy/imported rows; `total`
      // remains the strict money field that rejects malformed orders.
    ).rejects.toThrow('Paid order has invalid total');
  });

  it('throws the Supabase error from the paid order lookup', async () => {
    const error = new Error('order query failed');
    const supabase = createTableSupabaseMock({
      orders: [createQueryResult({ data: null, error })],
    });

    await expect(
      fetchPaidOrder({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).rejects.toThrow(error);
  });

  it('rejects impossible paid order null payloads from mocked single lookups', async () => {
    const supabase = createTableSupabaseMock({
      orders: [createQueryResult({ data: null })],
    });

    await expect(
      fetchPaidOrder({
        merchantId: 'merchant-1',
        orderId: 'missing-order',
        supabase: asSupabaseClient(supabase.client),
      })
    ).rejects.toThrow('Paid order payload is invalid');
  });

  it('fetches order payment transactions by id or wallet DVA reference', async () => {
    const transactionRow = {
      amount: 20_000,
      gateway_reference: 'WALLET-DVA-ORDER-order-1',
      id: 'transaction-1',
      merchant_id: 'merchant-1',
      order_id: 'order-1',
    };
    const byIdQuery = createQueryResult({ data: transactionRow });
    const byOrderQuery = createQueryResult({ data: transactionRow });
    const supabase = createTableSupabaseMock({
      transactions: [byIdQuery, byOrderQuery],
    });

    await expect(
      fetchOrderPaymentTransaction({
        merchantId: 'merchant-1',
        transactionId: 'transaction-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).resolves.toMatchObject({ id: 'transaction-1' });
    await expect(
      fetchOrderPaymentTransactionByOrder({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).resolves.toMatchObject({ id: 'transaction-1' });
    expect(byIdQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(byOrderQuery.eq).toHaveBeenCalledWith(
      'gateway_reference',
      `${WALLET_ORDER_GATEWAY_PREFIX}order-1`
    );
    expect(byOrderQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
  });

  it('rejects malformed order payment transactions before side effects run', async () => {
    const malformedTransactionRow = {
      amount: '',
      gateway_reference: 'WALLET-DVA-ORDER-order-1',
      id: 'transaction-1',
      merchant_id: 'merchant-1',
      order_id: 'order-1',
    };
    const supabase = createTableSupabaseMock({
      transactions: [createQueryResult({ data: malformedTransactionRow })],
    });

    await expect(
      fetchOrderPaymentTransaction({
        merchantId: 'merchant-1',
        transactionId: 'transaction-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).rejects.toThrow('Invalid wallet order payment transaction by id');
  });

  it('rejects impossible transaction null payloads from mocked single lookups', async () => {
    const supabase = createTableSupabaseMock({
      transactions: [createQueryResult({ data: null })],
    });

    await expect(
      fetchOrderPaymentTransaction({
        merchantId: 'merchant-1',
        transactionId: 'missing-transaction',
        supabase: asSupabaseClient(supabase.client),
      })
    ).rejects.toThrow('Invalid wallet order payment transaction by id');
  });

  it('throws Supabase transaction errors and returns null for missing fallback rows', async () => {
    const byIdError = new Error('transaction query failed');
    const byOrderError = new Error('fallback transaction query failed');
    const supabase = createTableSupabaseMock({
      transactions: [
        createQueryResult({ data: null, error: byIdError }),
        createQueryResult({ data: null, error: byOrderError }),
        createQueryResult({ data: null }),
      ],
    });

    await expect(
      fetchOrderPaymentTransaction({
        merchantId: 'merchant-1',
        transactionId: 'transaction-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).rejects.toThrow(byIdError);
    await expect(
      fetchOrderPaymentTransactionByOrder({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).rejects.toThrow(byOrderError);
    await expect(
      fetchOrderPaymentTransactionByOrder({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        supabase: asSupabaseClient(supabase.client),
      })
    ).resolves.toBeNull();
  });
});
