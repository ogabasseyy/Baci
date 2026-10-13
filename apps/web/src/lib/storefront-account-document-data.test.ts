import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  getCurrentDocumentKind,
  getStorefrontAccountDocumentData,
  isReceiptEligible,
  normalizePaymentStatus,
  normalizeShippingStatus,
} from '@/lib/storefront-account-document-data';

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

describe('storefront account document status helpers', () => {
  it('normalizes payment and shipping statuses to lowercase tokens', () => {
    expect(normalizePaymentStatus('PAID')).toBe('paid');
    expect(normalizePaymentStatus('Partially_Paid')).toBe('partially_paid');
    expect(normalizeShippingStatus('Shipped')).toBe('shipped');
    expect(normalizeShippingStatus('DELIVERED')).toBe('delivered');
  });

  it('returns empty strings for missing statuses and normalizes unknown values', () => {
    expect(normalizePaymentStatus(undefined)).toBe('');
    expect(normalizePaymentStatus(null)).toBe('');
    expect(normalizePaymentStatus('   ')).toBe('');
    expect(normalizeShippingStatus(undefined)).toBe('');
    expect(normalizeShippingStatus(null)).toBe('');
    expect(normalizeShippingStatus('Ready For Pickup')).toBe(
      'ready_for_pickup'
    );
  });

  it('marks imported paid orders as receipt-eligible even without shipped status', () => {
    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'shipped',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'delivered',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
        externalSource: 'bumpa',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: '',
        importJobId: 'job-1',
      })
    ).toBe(true);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'partially_paid',
        shippingStatus: 'shipped',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: '',
        shippingStatus: 'delivered',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: undefined,
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'cancelled',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: 'paid',
        shippingStatus: 'returned',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: '',
        shippingStatus: '',
      })
    ).toBe(false);

    expect(
      isReceiptEligible({
        paymentStatus: '!'.repeat(120),
        shippingStatus: '@'.repeat(120),
      })
    ).toBe(false);
  });

  it('returns the current document kind from normalized status values', () => {
    expect(
      getCurrentDocumentKind({
        paymentStatus: 'PAID',
        shippingStatus: 'DELIVERED',
      })
    ).toBe('receipt');
    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'shipped',
      })
    ).toBe('receipt');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
        externalSource: 'bumpa',
      })
    ).toBe('receipt');
    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'processing',
        importJobId: 'job-1',
      })
    ).toBe('receipt');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'partially_paid',
        shippingStatus: 'shipped',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: '',
        shippingStatus: '',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'cancelled',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: 'paid',
        shippingStatus: 'pending',
      })
    ).toBe('invoice');

    expect(
      getCurrentDocumentKind({
        paymentStatus: '!'.repeat(120),
        shippingStatus: '@'.repeat(120),
      })
    ).toBe('invoice');
  });

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
