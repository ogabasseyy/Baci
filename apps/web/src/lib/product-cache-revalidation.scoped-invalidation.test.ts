import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));

vi.mock('next/cache', () => ({ revalidateTag }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';

describe('productCacheRevalidation scoped invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revalidateTag.mockReset();
  });

  it('skips merchant-wide PDP detail and redirect tags when omitMerchantWidePdpDetails is true', () => {
    expect(
      productCacheRevalidation.revalidateProducts('merchant-1', undefined, {
        expireImmediately: true,
        omitMerchantWidePdpDetails: true,
      })
    ).toBe(true);

    expect(revalidateTag).toHaveBeenCalledWith('products-merchant-1', {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith('product-slug-set-merchant-1', {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith('product-index-merchant-1', {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith(
      getCategoryPageDataCacheTag('merchant-1'),
      { expire: 0 }
    );
    expect(revalidateTag).toHaveBeenCalledWith('merchant-feed-merchant-1', {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith('dashboard-merchant-1', {
      expire: 0,
    });

    const calledTags = revalidateTag.mock.calls.map(([tag]) => tag);
    expect(calledTags).not.toContain('product-details-merchant-1');
    expect(calledTags).not.toContain('product-canonical-redirect-merchant-1');
    expect(calledTags).not.toContain('product-legacy-redirect-merchant-1');
  });
});
