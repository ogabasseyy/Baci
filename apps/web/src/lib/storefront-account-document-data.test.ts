import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getStorefrontAccountDocumentData } from '@/lib/storefront-account-document-data';
import { loadStorefrontCustomerPaymentAccounts } from '@/lib/storefront-customer-payment-accounts';
import { loadStorefrontCustomerTaxSubtotals } from '@/lib/storefront-customer-tax-subtotals';
import { loadStorefrontCustomerTransactions } from '@/lib/storefront-customer-transactions';

vi.mock('@/lib/storefront-customer-transactions', () => ({
  loadStorefrontCustomerTransactions: vi.fn(),
}));
vi.mock('@/lib/storefront-customer-payment-accounts', () => ({
  loadStorefrontCustomerPaymentAccounts: vi.fn(),
}));
vi.mock('@/lib/storefront-customer-tax-subtotals', () => ({
  loadStorefrontCustomerTaxSubtotals: vi.fn(),
}));

function createSupabaseMock(options?: {
  merchantResult?: {
    data: { id: string; slug: string } | null;
    error: unknown;
  };
  customerResult?: { data: { id: string } | null; error: unknown };
}) {
  const merchantQuery = {
    select: () => merchantQuery,
    eq: () => merchantQuery,
    maybeSingle: async () =>
      options?.merchantResult ?? {
        data: { id: 'merchant-1', slug: 'ogabassey' },
        error: null,
      },
  };
  const customerQuery = {
    select: () => customerQuery,
    eq: () => customerQuery,
    maybeSingle: async () =>
      options?.customerResult ?? {
        data: { id: 'customer-1' },
        error: null,
      },
  };

  return {
    from(table: string) {
      if (table === 'merchants') {
        return merchantQuery;
      }

      if (table === 'customers') {
        return customerQuery;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe('storefront account document data fetching', () => {
  it('throws a store-specific not-found error when the merchant lookup fails', async () => {
    await expect(
      getStorefrontAccountDocumentData({
        supabase: createSupabaseMock({
          merchantResult: {
            data: null,
            error: null,
          },
        }),
        userId: 'user-1',
        merchantSlug: 'ogabassey',
        orderId: 'order-1',
      })
    ).rejects.toMatchObject({
      message: 'Store not found',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('classifies a covered order with a rejected payment as invoice', async () => {
    const order = {
      id: 'order-1',
      order_number: 'ORD-1',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: null,
      tracking_number: null,
      shipping_status: 'pending',
      payment_status: 'paid',
      shipping_provider: null,
      shipping_rate_id: null,
      shipping_rate_name: null,
      shipping_pickup_details: null,
      payment_method: null,
      currency: 'NGN',
      total: 100,
      subtotal: 100,
      shipping_fee: 0,
      tax_amount: 0,
      discount_amount: 0,
      amount_paid: 100,
      customer_name: 'Ada',
      customer_email: 'ada@example.com',
      customer_phone: null,
      recorded_by_user_id: 'staff-1',
      import_job_id: null,
      external_source: null,
      is_credit_order: false,
      invoice_type_code: null,
      invoice_note: null,
      fulfillment_details: null,
    };
    const items = [
      {
        id: 'item-1',
        product_id: 'prod-1',
        variant_id: null,
        condition: null,
        variant_name: null,
        name: 'Device',
        item_description: 'Midnight 128GB',
        quantity: 1,
        price: 100,
      },
    ];
    const queryFor = (data: unknown) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable.
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data, error: null }),
      };
      return query;
    };
    const supabase = {
      from: (table: string) => {
        if (table === 'merchants')
          return queryFor({ id: 'merchant-1', slug: 'ogabassey' });
        if (table === 'customers') return queryFor({ id: 'customer-1' });
        if (table === 'orders') return queryFor(order);
        if (table === 'order_items') return queryFor(items);
        throw new Error(`Unexpected table: ${table}`);
      },
      rpc: async () => ({ data: false, error: null }),
    };
    vi.mocked(loadStorefrontCustomerTransactions).mockResolvedValue({
      data: [
        {
          id: 'txn-1',
          order_id: 'order-1',
          amount: -50,
          created_at: '2026-09-30T09:00:00Z',
          description: null,
          metadata: null,
          gateway: null,
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    vi.mocked(loadStorefrontCustomerPaymentAccounts).mockResolvedValue({
      data: [],
      error: null,
    });
    vi.mocked(loadStorefrontCustomerTaxSubtotals).mockResolvedValue({
      data: [],
      error: null,
    });

    const data = await getStorefrontAccountDocumentData({
      supabase: supabase as unknown as SupabaseClient,
      userId: 'user-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
    });

    expect(data.order.current_document_kind).toBe('invoice');
    expect(data.order.receipt_eligible).toBe(false);
    expect(data.receiptOrder.items[0]?.description).toBe('Midnight 128GB');
  });

  it('throws a customer-specific not-found error when the customer lookup fails', async () => {
    await expect(
      getStorefrontAccountDocumentData({
        supabase: createSupabaseMock({
          customerResult: {
            data: null,
            error: null,
          },
        }),
        userId: 'user-1',
        merchantSlug: 'ogabassey',
        orderId: 'order-1',
      })
    ).rejects.toMatchObject({
      message: 'Customer not found',
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
