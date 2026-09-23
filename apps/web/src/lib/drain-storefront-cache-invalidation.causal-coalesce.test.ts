import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloudflare: vi.fn(),
  products: vi.fn(),
  categories: vi.fn(),
  revalidateTag: vi.fn(),
  vercel: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock('@/lib/strict-cloudflare-hostname-purge', () => ({
  strictCloudflareHostnamePurge: mocks.cloudflare,
}));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: { revalidateProducts: mocks.products },
}));
vi.mock('@/lib/revalidate-categories', () => ({
  revalidateCategories: mocks.categories,
}));
vi.mock('@/lib/vercel-storefront-publication-cache', () => ({
  purgeVercelStorefrontPublicationCache: mocks.vercel,
}));

import { drainStorefrontCacheInvalidation } from './drain-storefront-cache-invalidation';

/** Mirrors enqueue_storefront_cache_targets after shared related_identifiers + generation sync. */
function productionPairClaims() {
  const relatedIdentifiers = ['ogabassey', 'ogabassey.com'];
  const shared = {
    attempts: 1,
    generation: 6,
    merchant_id: '22222222-2222-4222-8222-222222222222',
    product_slugs: ['cache-phone'],
    related_identifiers: relatedIdentifiers,
  };
  return {
    hostnameClaim: {
      ...shared,
      claim_token: '22222222-2222-4222-8222-222222222222',
      target_id: 'ogabassey.com',
      target_kind: 'storefront_hostname' as const,
    },
    slugClaim: {
      ...shared,
      claim_token: '11111111-1111-4111-8111-111111111111',
      target_id: 'ogabassey',
      target_kind: 'storefront_slug' as const,
    },
  };
}

describe('bugfix: causal purge coalescing across target rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    mocks.products.mockReturnValue(true);
    mocks.vercel.mockResolvedValue({ ok: true, reason: 'deleted' });
    mocks.cloudflare.mockResolvedValue({ ok: true });
  });

  it('coalesces production slug and hostname claims that share causal identity', async () => {
    let releaseVercel!: (value: { ok: true; reason: 'deleted' }) => void;
    mocks.vercel.mockReturnValue(
      new Promise((resolve) => {
        releaseVercel = resolve;
      })
    );
    const { hostnameClaim, slugClaim } = productionPairClaims();
    const first = drainStorefrontCacheInvalidation(slugClaim);
    const second = drainStorefrontCacheInvalidation(hostnameClaim);
    await Promise.resolve();
    expect(mocks.vercel).toHaveBeenCalledTimes(1);
    releaseVercel({ ok: true, reason: 'deleted' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(mocks.cloudflare).toHaveBeenCalledTimes(1);
  });
});
