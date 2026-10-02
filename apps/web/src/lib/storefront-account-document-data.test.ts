import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { getStorefrontAccountDocumentData } from '@/lib/storefront-account-document-data';

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
