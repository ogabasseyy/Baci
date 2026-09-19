import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleCheckoutProductBlogPurge } from './schedule-checkout-product-blog-purge';

const mocks = vi.hoisted(() => ({
  revalidateProductSlugs: vi.fn(),
  revalidateProducts: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: mocks.revalidateProductSlugs,
  revalidateProducts: mocks.revalidateProducts,
}));
vi.mock('@/lib/schedule-order-product-blog-purge-after-response', () => ({
  scheduleOrderProductBlogPurgeAfterResponse: mocks.schedule,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function createSupabase({
  productResult,
  variantResult = { data: [], error: null },
}: {
  productResult: { data: unknown[] | null; error: unknown };
  variantResult?: { data: unknown[] | null; error: unknown };
}) {
  const supabase = {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            returns: vi
              .fn()
              .mockResolvedValue(
                table === 'products' ? productResult : variantResult
              ),
          })),
        })),
      })),
    })),
  };
  return supabase as unknown as SupabaseClient;
}

describe('scheduleCheckoutProductBlogPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges managed and serialized products after checkout stock changes', async () => {
    const supabase = createSupabase({
      productResult: {
        data: [
          { id: 'managed', slug: 'managed-phone', manage_stock: true },
          { id: 'serialized', slug: 'serialized-phone', manage_stock: false },
        ],
        error: null,
      },
      variantResult: {
        data: [
          {
            product_id: 'serialized',
            inventory_tracking_policy: 'serialized_strict',
          },
        ],
        error: null,
      },
    });

    await scheduleCheckoutProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      orderItems: [
        { product_id: 'managed', variant_id: 'variant-1' },
        { product_id: 'serialized', variant_id: 'variant-2' },
      ],
      supabase,
    });

    expect(mocks.revalidateProducts).toHaveBeenCalledWith('merchant-1');
    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'managed-phone',
      'serialized-phone',
    ]);
    expect(mocks.schedule).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['managed', 'serialized'],
      supabase,
    });
  });

  it('preserves known product purges when the product projection fails', async () => {
    const supabase = createSupabase({
      productResult: {
        data: null,
        error: { message: 'temporary product read failure' },
      },
    });

    await scheduleCheckoutProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      orderItems: [{ product_id: 'managed' }],
      supabase,
    });

    expect(mocks.revalidateProducts).toHaveBeenCalledWith('merchant-1');
    expect(mocks.revalidateProductSlugs).not.toHaveBeenCalled();
    expect(mocks.schedule).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['managed'],
      supabase,
    });
  });

  it('keeps unmanaged candidates when variant policy lookup fails', async () => {
    const supabase = createSupabase({
      productResult: {
        data: [
          { id: 'unmanaged', slug: 'unmanaged-phone', manage_stock: false },
        ],
        error: null,
      },
      variantResult: {
        data: null,
        error: { message: 'temporary variant read failure' },
      },
    });

    await scheduleCheckoutProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      orderItems: [{ product_id: 'unmanaged', variant_id: 'variant-1' }],
      supabase,
    });

    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ productIds: ['unmanaged'] })
    );
  });
});
