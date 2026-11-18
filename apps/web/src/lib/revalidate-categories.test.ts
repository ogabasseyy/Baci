import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCategoryPageDataCacheTag } from './category-page-cache-tags';

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));

import { revalidateCategories } from './revalidate-categories';

const MERCHANT_ID = 'merchant-1';

describe('revalidateCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evicts only merchant-scoped navigation, category, and redirect tags', () => {
    revalidateCategories(MERCHANT_ID);

    const tags = mocks.revalidateTag.mock.calls.map(([tag]) => tag);
    expect(tags).toEqual([
      `categories-${MERCHANT_ID}`,
      `navigation-categories-${MERCHANT_ID}`,
      getCategoryPageDataCacheTag(MERCHANT_ID),
      `product-canonical-redirect-${MERCHANT_ID}`,
      `product-legacy-redirect-${MERCHANT_ID}`,
    ]);
    expect(tags).not.toContain('navigation-categories');
    expect(tags).not.toContain('product-canonical-redirect');
    expect(tags).not.toContain('product-legacy-redirect');
  });

  it('adds the slug-scoped tag when a slug is given', () => {
    revalidateCategories(MERCHANT_ID, 'phones');

    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      `category-${MERCHANT_ID}-phones`,
      'categories'
    );
  });

  it('hard-expires category data before an outer CDN eviction', () => {
    revalidateCategories(MERCHANT_ID, 'phones', {
      expireImmediately: true,
    });

    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      `categories-${MERCHANT_ID}`,
      { expire: 0 }
    );
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      `category-${MERCHANT_ID}-phones`,
      { expire: 0 }
    );
  });

  it('propagates cache API failures to the mutation caller', () => {
    mocks.revalidateTag.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    expect(() => revalidateCategories(MERCHANT_ID)).toThrow(
      'cache unavailable'
    );
  });

  it('warns and skips revalidation when merchantId is blank', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Expected in this runtime-guard test.
    });

    revalidateCategories('   ');

    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[revalidateCategories] Skipped category cache revalidation for invalid merchant ID'
    );
    warnSpy.mockRestore();
  });

  it('stays free of credential-reaching imports', async () => {
    // The whole point of this module: category API routes import it instead of
    // cache-revalidation, which pulls cloudflare-purge -> getCloudflareApiToken.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(import.meta.dirname, 'revalidate-categories.ts'),
      'utf8'
    );

    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual([
      "import { revalidateTag } from 'next/cache';",
      "import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';",
      "import { normalizeMerchantId } from '@/lib/normalize-merchant-id';",
    ]);
  });
});
