import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn((cb: () => void) => cb()),
  revalidateBlogFeed: vi.fn(),
  revalidateDomains: vi.fn(),
  revalidateMerchant: vi.fn(),
  revalidateMerchantFeed: vi.fn(),
  revalidateMerchantSlugLookup: vi.fn(),
  revalidatePageConfig: vi.fn(),
  revalidateStorefrontProductsSlugCache: vi.fn(),
  invalidateForwardDomainCacheForSlug: vi.fn(),
  invalidateReverseDomainCacheForSlug: vi.fn(),
  invalidateAliasCacheForSlug: vi.fn(),
  triggerDomainEdgeConfigSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/server', () => ({
  after: mocks.after,
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogFeed: mocks.revalidateBlogFeed,
  revalidateDomains: mocks.revalidateDomains,
  revalidateMerchant: mocks.revalidateMerchant,
  revalidateMerchantFeed: mocks.revalidateMerchantFeed,
  revalidateMerchantSlugLookup: mocks.revalidateMerchantSlugLookup,
  revalidatePageConfig: mocks.revalidatePageConfig,
  revalidateStorefrontProductsSlugCache:
    mocks.revalidateStorefrontProductsSlugCache,
}));

vi.mock('@/lib/domain-cache-simple', () => ({
  invalidateForwardDomainCacheForSlug:
    mocks.invalidateForwardDomainCacheForSlug,
  invalidateReverseDomainCacheForSlug:
    mocks.invalidateReverseDomainCacheForSlug,
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  invalidateAliasCacheForSlug: mocks.invalidateAliasCacheForSlug,
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: mocks.triggerDomainEdgeConfigSync,
}));

import { invalidateMerchantSlugRename } from './invalidate-merchant-slug-rename';

describe('invalidateMerchantSlugRename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockImplementation((cb: () => void) => cb());
  });

  it('invalidates retired and final slugs, revalidates caches, and triggers Edge Config sync', () => {
    invalidateMerchantSlugRename({
      merchantId: 'merchant-1',
      finalSlug: 'new-slug',
      retiredSlug: 'old-slug',
    });

    expect(mocks.revalidateMerchant).toHaveBeenCalledWith(
      'merchant-1',
      'new-slug'
    );
    expect(mocks.revalidateDomains).toHaveBeenCalledOnce();
    expect(mocks.revalidatePageConfig).toHaveBeenCalledWith('merchant-1');
    expect(mocks.revalidateMerchantFeed).toHaveBeenCalledWith('merchant-1');
    expect(mocks.revalidateBlogFeed).toHaveBeenCalledOnce();
    expect(mocks.revalidateMerchantSlugLookup).toHaveBeenCalledWith('old-slug');
    expect(mocks.revalidateMerchantSlugLookup).toHaveBeenCalledWith('new-slug');
    expect(mocks.revalidateStorefrontProductsSlugCache).toHaveBeenCalledOnce();
    expect(mocks.invalidateReverseDomainCacheForSlug).toHaveBeenCalledWith(
      'old-slug'
    );
    expect(mocks.invalidateForwardDomainCacheForSlug).toHaveBeenCalledWith(
      'old-slug'
    );
    expect(mocks.invalidateForwardDomainCacheForSlug).toHaveBeenCalledWith(
      'new-slug'
    );
    expect(mocks.invalidateAliasCacheForSlug).toHaveBeenCalledWith('old-slug');
    expect(mocks.invalidateAliasCacheForSlug).toHaveBeenCalledWith('new-slug');
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.triggerDomainEdgeConfigSync).toHaveBeenCalledOnce();
  });

  it('skips retired-slug invalidation when retiredSlug is absent or equals finalSlug', () => {
    invalidateMerchantSlugRename({
      merchantId: 'merchant-1',
      finalSlug: 'same-slug',
      retiredSlug: 'same-slug',
    });

    expect(mocks.invalidateReverseDomainCacheForSlug).not.toHaveBeenCalled();
    expect(mocks.revalidateMerchantSlugLookup).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateMerchantSlugLookup).toHaveBeenCalledWith(
      'same-slug'
    );
  });

  it('falls back to calling triggerDomainEdgeConfigSync when after() throws outside request scope', () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error('after called outside request scope');
    });

    invalidateMerchantSlugRename({
      merchantId: 'merchant-1',
      finalSlug: 'new-slug',
      retiredSlug: null,
    });

    expect(mocks.triggerDomainEdgeConfigSync).toHaveBeenCalledOnce();
  });
});
