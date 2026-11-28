import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateTag = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateCategories = vi.fn();
const mockPurgeVercel = vi.fn();
const mockStrictCloudflarePurge = vi.fn();
const mockResolveMerchantSaasPurgeTargets = vi.fn();

vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  },
}));

vi.mock('@/lib/revalidate-categories', () => ({
  revalidateCategories: (...args: unknown[]) =>
    mockRevalidateCategories(...args),
}));

vi.mock('@/lib/vercel-storefront-publication-cache', () => ({
  purgeVercelStorefrontPublicationCache: (...args: unknown[]) =>
    mockPurgeVercel(...args),
}));

vi.mock('@/lib/strict-cloudflare-hostname-purge', () => ({
  strictCloudflareHostnamePurge: (...args: unknown[]) =>
    mockStrictCloudflarePurge(...args),
}));

vi.mock('@/lib/merchant-saas-purge-targets', () => ({
  resolveMerchantSaasPurgeTargets: (...args: unknown[]) =>
    mockResolveMerchantSaasPurgeTargets(...args),
}));

import { drainStorefrontCacheInvalidation } from './drain-storefront-cache-invalidation';

const NEW_MERCHANT_CLAIM = {
  claim_token: 'tok-1',
  generation: 42,
  merchant_id: 'merchant-new-saas',
  product_slugs: ['red-sneaker'],
  related_identifiers: ['new-merchant-slug'],
  target_id: 'new-merchant-slug',
  target_kind: 'storefront_slug' as const,
};

describe('drainStorefrontCacheInvalidation dynamic SaaS purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockPurgeVercel.mockResolvedValue({ ok: true, reason: 'deleted' });
  });

  it('purges newly onboarded SaaS merchant hostnames in CLOUDFLARE_SAAS_ZONE_ID', async () => {
    mockResolveMerchantSaasPurgeTargets.mockResolvedValue({
      ok: true,
      zones: new Map([['zone_saas_1', ['shop.newmerchant.com']]]),
    });
    mockStrictCloudflarePurge.mockResolvedValue({ ok: true });

    const res = await drainStorefrontCacheInvalidation(NEW_MERCHANT_CLAIM);
    expect(res).toEqual({ ok: true });
    expect(mockStrictCloudflarePurge).toHaveBeenCalledWith(
      ['shop.newmerchant.com'],
      { zoneId: 'zone_saas_1' }
    );
  });

  it('fails closed when SaaS zone purge fails so the outbox retries', async () => {
    mockResolveMerchantSaasPurgeTargets.mockResolvedValue({
      ok: true,
      zones: new Map([['zone_saas_1', ['shop.newmerchant.com']]]),
    });
    mockStrictCloudflarePurge.mockResolvedValue({
      ok: false,
      errorCode: 'cloudflare_http_502',
    });

    const res = await drainStorefrontCacheInvalidation(NEW_MERCHANT_CLAIM);
    expect(res).toEqual({ ok: false, errorCode: 'cloudflare_http_502' });
  });
});
