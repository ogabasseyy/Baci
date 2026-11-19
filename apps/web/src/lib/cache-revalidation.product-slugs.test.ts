import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
const mockPurgeCloudflareUrls = vi.fn();
const mockAfter = vi.fn((callback: () => unknown) => {
  callback();
});

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => mockAfter(callback),
}));
vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareUrls: (...args: unknown[]) => mockPurgeCloudflareUrls(...args),
}));

import { getProductScopedCacheTag } from '@/lib/product-cache-tags';
import { revalidateProductSlugs } from './cache-revalidation';

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('revalidateProductSlugs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the per-slug scoped product and redirect tags for each slug', () => {
    revalidateProductSlugs(MERCHANT_ID, ['iphone-15', 'galaxy-s25']);

    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag(
        'product-canonical-redirect',
        MERCHANT_ID,
        'iphone-15'
      ),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag(
        'product-legacy-redirect',
        MERCHANT_ID,
        'iphone-15'
      ),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag('product', MERCHANT_ID, 'galaxy-s25'),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag(
        'product-canonical-redirect',
        MERCHANT_ID,
        'galaxy-s25'
      ),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag(
        'product-legacy-redirect',
        MERCHANT_ID,
        'galaxy-s25'
      ),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledTimes(6);
  });

  it('deduplicates and skips blank/nullish slugs', () => {
    revalidateProductSlugs(MERCHANT_ID, [
      'iphone-15',
      '  iphone-15  ',
      '   ',
      null,
      undefined,
    ]);

    expect(mockRevalidateTag).toHaveBeenCalledTimes(3);
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag(
        'product-canonical-redirect',
        MERCHANT_ID,
        'iphone-15'
      ),
      'products'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag(
        'product-legacy-redirect',
        MERCHANT_ID,
        'iphone-15'
      ),
      'products'
    );
  });

  it('is a no-op for a blank merchant id', () => {
    revalidateProductSlugs('   ', ['iphone-15']);

    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});
