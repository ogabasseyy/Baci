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

function makeSupabase(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            returns: vi.fn().mockResolvedValue({ data: rows, error: null }),
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

describe('scheduleCheckoutProductBlogPurge scoped invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revalidateProductSlugs.mockReturnValue(true);
  });

  it('falls back to full merchant-wide invalidation when product slug resolution is incomplete', async () => {
    const supabase = makeSupabase([
      { id: 'managed', slug: 'managed-phone', manage_stock: true },
    ]);

    await scheduleCheckoutProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      orderItems: [{ product_id: 'managed' }, { product_id: 'missing' }],
      supabase,
    });

    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      ['managed-phone', 'managed', 'missing'],
      { expireImmediately: true }
    );
    expect(mocks.revalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('falls back to full merchant-wide invalidation when revalidateProductSlugs returns false', async () => {
    const supabase = makeSupabase([
      { id: 'managed', slug: 'managed-phone', manage_stock: true },
    ]);
    mocks.revalidateProductSlugs.mockReturnValueOnce(false);

    await scheduleCheckoutProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      orderItems: [{ product_id: 'managed' }],
      supabase,
    });

    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      ['managed-phone', 'managed'],
      { expireImmediately: true }
    );
    expect(mocks.revalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('falls back to full merchant-wide invalidation when orderItems have no product_id', async () => {
    const supabase = makeSupabase([]);

    await scheduleCheckoutProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      orderItems: [{ product_id: null }],
      supabase,
    });

    expect(mocks.revalidateProductSlugs).not.toHaveBeenCalled();
    expect(mocks.revalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });
});
