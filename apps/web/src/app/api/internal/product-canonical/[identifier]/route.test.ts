import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInternalApiSecret = vi.fn();
const mockGetCachedMerchant = vi.fn();
const mockGetCachedMerchantByDomain = vi.fn();
const mockGetCachedProductCanonicalRedirectTarget = vi.fn();
const mockGetCachedStorefrontProductSlugResolution = vi.fn();

vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));
vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: (...args: unknown[]) => mockGetCachedMerchant(...args),
  getCachedMerchantByDomain: (...args: unknown[]) =>
    mockGetCachedMerchantByDomain(...args),
  getCachedProductCanonicalRedirectTarget: (...args: unknown[]) =>
    mockGetCachedProductCanonicalRedirectTarget(...args),
}));
vi.mock('@/lib/cached-storefront-product-slug-resolution', () => ({
  getCachedStorefrontProductSlugResolution: (...args: unknown[]) =>
    mockGetCachedStorefrontProductSlugResolution(...args),
}));

import { GET } from './route';

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const IDENTIFIER = 'ogabassey.com';
const SECRET = 'test-internal-secret';
const FAIL_OPEN = { hasError: true, matchedProduct: false, redirectPath: null };
const UNKNOWN_STOREFRONT_FAIL_OPEN = {
  ...FAIL_OPEN,
  failOpenReason: 'unknown-storefront',
};
const PREFLIGHT_CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=3600';
// Product mutations purge the slug-set tag; category slug changes (which move
// canonical paths without a slug-set mutation) purge the global
// canonical-redirect tag. Comma = Vercel tag separator.
const PREFLIGHT_CACHE_TAG = `product-slug-set-${MERCHANT_ID},product-canonical-redirect,product-canonical-redirect-${MERCHANT_ID}`;

// Default to the custom cacheable auth path (what the proxy sends in
// production); the legacy Authorization path is exercised by dedicated
// no-store regression tests below.
function request(
  params: { category?: string; slug?: string } = {},
  headers: Record<string, string> = { 'x-baci-internal-auth': SECRET }
): NextRequest {
  const url = new URL(
    `https://platform.test/api/internal/product-canonical/${IDENTIFIER}`
  );
  if (params.category !== undefined)
    url.searchParams.set('category', params.category);
  if (params.slug !== undefined) url.searchParams.set('slug', params.slug);
  return new NextRequest(url, { headers });
}

function context(identifier = IDENTIFIER) {
  return { params: Promise.resolve({ identifier }) };
}

describe('GET /api/internal/product-canonical/[identifier]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockGetCachedMerchant.mockResolvedValue({
      id: MERCHANT_ID,
      is_published: true,
    });
    mockGetCachedMerchantByDomain.mockResolvedValue({
      id: MERCHANT_ID,
      is_published: true,
    });
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue(null);
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValue({
      hasError: false,
      present: false,
    });
  });

  it('returns a redirect path when an active product is requested under the wrong category', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'TECNO Spark 40',
      slug: 'tecno-spark-40',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'active',
    });

    const res = await GET(
      request({ category: 'tecno', slug: 'tecno-spark-40' }),
      context()
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: '/smartphones/tecno-spark-40',
    });
    expect(mockGetCachedProductCanonicalRedirectTarget).toHaveBeenCalledWith(
      MERCHANT_ID,
      'tecno-spark-40'
    );
  });

  it('returns no redirect when the active product request already matches the canonical path', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'TECNO Spark 40',
      slug: 'tecno-spark-40',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'active',
    });

    const res = await GET(
      request({ category: 'smartphones', slug: 'tecno-spark-40' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: null,
    });
    expect(res.headers.get('Cache-Control')).toBe(PREFLIGHT_CACHE_CONTROL);
    expect(res.headers.get('Vary')).toBe('x-baci-internal-auth');
    expect(res.headers.get('Vercel-Cache-Tag')).toBe(PREFLIGHT_CACHE_TAG);
  });

  it('ignores stale stored canonical_url values when the product fields already match', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      canonical_url: '/products/pixel-10',
      id: 'product-1',
      name: 'Pixel 10',
      slug: 'pixel-10',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'active',
    });

    const res = await GET(
      request({ category: 'smartphones', slug: 'pixel-10' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: null,
    });
  });

  it('builds stale-category redirects from product fields instead of stale canonical_url', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      canonical_url: '/products/pixel-10',
      id: 'product-1',
      name: 'Pixel 10',
      slug: 'pixel-10',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'active',
    });

    const res = await GET(
      request({ category: 'google', slug: 'pixel-10' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: '/smartphones/pixel-10',
    });
  });

  it('does not redirect normalized public category aliases back to legacy stored paths', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'iPhone 12',
      slug: 'iphone-12',
      category: 'Phones',
      category_slug: 'phones',
      categories: { name: 'Phones', slug: 'phones' },
      status: 'active',
    });

    const res = await GET(
      request({ category: 'smartphones', slug: 'iphone-12' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: null,
    });
  });

  it('returns the normalized public alias target for stale product category URLs', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'iPhone 12',
      slug: 'iphone-12',
      category: 'Phones',
      category_slug: 'phones',
      categories: { name: 'Phones', slug: 'phones' },
      status: 'active',
    });

    const res = await GET(
      request({ category: 'tecno', slug: 'iphone-12' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: '/smartphones/iphone-12',
    });
  });

  it('handles Supabase relationship arrays when building the canonical path', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'iPhone 15',
      slug: 'iphone-15',
      category: 'Smartphones',
      categories: [{ name: 'Smartphones', slug: 'smartphones' }],
      status: 'active',
    });

    const res = await GET(
      request({ category: 'apple', slug: 'iphone-15' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: '/smartphones/iphone-15',
    });
  });

  it('returns a redirect path for an archived child product with an active parent', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'archived-child-1',
      name: 'Samsung Galaxy Z Fold6 12GB 256GB',
      slug: 'samsung-galaxy-z-fold-6-12gb-256gb',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'archived',
    });
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValue({
      hasError: false,
      present: true,
      redirectTarget: {
        id: 'parent-1',
        name: 'Samsung Galaxy Z Fold6',
        slug: 'samsung-galaxy-z-fold-6',
        category: 'Smartphones',
        categories: { name: 'Smartphones', slug: 'smartphones' },
      },
    });

    const res = await GET(
      request({
        category: 'smartphones',
        slug: 'samsung-galaxy-z-fold-6-12gb-256gb',
      }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: '/smartphones/samsung-galaxy-z-fold-6',
    });
    expect(mockGetCachedStorefrontProductSlugResolution).toHaveBeenCalledWith(
      MERCHANT_ID,
      'samsung-galaxy-z-fold-6-12gb-256gb'
    );
  });

  it('marks no-match responses so the proxy can continue to the slug resolver', async () => {
    const res = await GET(
      request({ category: 'smartphones', slug: 'missing-product' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: false,
      redirectPath: null,
    });
    // An absent verdict must never stick: a product published after a cached
    // miss would otherwise skip canonicalization for the whole TTL window.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('accepts the custom internal auth header and edge-caches the live no-redirect verdict', async () => {
    // Category-AWARE primary lookup: only this path may be cached — it proves
    // the requested category is canonical.
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'iPhone 15',
      slug: 'iphone-15',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'active',
    });

    const res = await GET(
      request(
        { category: 'smartphones', slug: 'iphone-15' },
        { 'x-baci-internal-auth': SECRET }
      ),
      context()
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: null,
    });
    expect(res.headers.get('Cache-Control')).toBe(PREFLIGHT_CACHE_CONTROL);
    expect(res.headers.get('Vary')).toBe('x-baci-internal-auth');
    expect(res.headers.get('Vercel-Cache-Tag')).toBe(PREFLIGHT_CACHE_TAG);
  });

  it('keeps redirect verdicts no-store so a changed canonical target is never sticky', async () => {
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'TECNO Spark 40',
      slug: 'tecno-spark-40',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'active',
    });

    const res = await GET(
      request(
        { category: 'tecno', slug: 'tecno-spark-40' },
        { 'x-baci-internal-auth': SECRET }
      ),
      context()
    );

    expect((await res.json()).redirectPath).toBe('/smartphones/tecno-spark-40');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('resolves custom-domain identifiers through the domain cache path', async () => {
    const res = await GET(
      request({ category: 'smartphones', slug: 'missing-product' }),
      context('shop.example.com')
    );

    expect(res.status).toBe(200);
    expect(mockGetCachedMerchantByDomain).toHaveBeenCalledWith(
      'shop.example.com'
    );
    expect(mockGetCachedMerchant).not.toHaveBeenCalled();
  });

  it('resolves slug identifiers through the slug cache path', async () => {
    const res = await GET(
      request({ category: 'smartphones', slug: 'missing-product' }),
      context('ogabassey')
    );

    expect(res.status).toBe(200);
    expect(mockGetCachedMerchant).toHaveBeenCalledWith('ogabassey');
    expect(mockGetCachedMerchantByDomain).not.toHaveBeenCalled();
  });

  it('fails open when the public slug-resolution RPC is uncertain', async () => {
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValue({
      hasError: true,
      present: false,
    });

    const res = await GET(
      request({ category: 'smartphones', slug: 'legacy-alias' }),
      context()
    );

    expect(await res.json()).toEqual(FAIL_OPEN);
  });

  it('marks category-blind slug-resolution matches as checked but never caches them', async () => {
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValue({
      hasError: false,
      present: true,
    });

    const res = await GET(
      request({ category: 'smartphones', slug: 'iphone-15' }),
      context()
    );

    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: null,
    });
    // `present` alone cannot prove the REQUESTED category is canonical (the
    // category-aware primary lookup missed), so caching this verdict could
    // suppress the proxy 308 for wrong-category PDP URLs.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('marks unpublished merchants as expected unknown-storefront fail-opens', async () => {
    mockGetCachedMerchantByDomain.mockResolvedValue({
      id: MERCHANT_ID,
      is_published: false,
    });

    const res = await GET(
      request({ category: 'smartphones', slug: 'iphone-15' }),
      context()
    );

    expect(await res.json()).toEqual(UNKNOWN_STOREFRONT_FAIL_OPEN);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetCachedProductCanonicalRedirectTarget).not.toHaveBeenCalled();
    expect(mockGetCachedStorefrontProductSlugResolution).not.toHaveBeenCalled();
  });

  it('fails open plainly for invalid input but marks unresolved merchants as unknown-storefront', async () => {
    expect(
      await (await GET(request({ slug: 'iphone-15' }), context())).json()
    ).toEqual(FAIL_OPEN);

    mockGetCachedMerchantByDomain.mockResolvedValue(null);
    expect(
      await (
        await GET(request({ category: 'apple', slug: 'iphone-15' }), context())
      ).json()
    ).toEqual(UNKNOWN_STOREFRONT_FAIL_OPEN);
  });

  it('fails open plainly when the merchant lookup throws (transient error)', async () => {
    mockGetCachedMerchantByDomain.mockRejectedValue(
      new Error('supabase timeout')
    );

    const res = await GET(
      request({ category: 'apple', slug: 'iphone-15' }),
      context()
    );

    expect(await res.json()).toEqual(FAIL_OPEN);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('accepts legacy Bearer auth but keeps even the live no-redirect verdict no-store', async () => {
    // Same category-aware cacheable verdict as the custom-header test above —
    // only the auth method differs, isolating it as the no-store cause.
    mockGetCachedProductCanonicalRedirectTarget.mockResolvedValue({
      id: 'product-1',
      name: 'iPhone 15',
      slug: 'iphone-15',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      status: 'active',
    });

    const res = await GET(
      request(
        { category: 'smartphones', slug: 'iphone-15' },
        { Authorization: `Bearer ${SECRET}` }
      ),
      context()
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hasError: false,
      matchedProduct: true,
      redirectPath: null,
    });
    // RFC 9111 lets a shared cache store an Authorization-request response
    // when s-maxage is present, so the legacy path must never emit cacheable
    // headers — the entry would be keyed with the custom header absent, the
    // same Vary key an unauthenticated request hits.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('returns 401 when the bearer token is invalid', async () => {
    const res = await GET(
      request(
        { category: 'apple', slug: 'iphone-15' },
        { Authorization: 'Bearer wrong' }
      ),
      context()
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetCachedMerchantByDomain).not.toHaveBeenCalled();
  });

  it('returns 401 when the custom internal auth header is invalid', async () => {
    const res = await GET(
      request(
        { category: 'apple', slug: 'iphone-15' },
        { 'x-baci-internal-auth': 'wrong' }
      ),
      context()
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockGetCachedMerchantByDomain).not.toHaveBeenCalled();
  });

  it('returns 500 when the internal API secret is not configured', async () => {
    mockGetInternalApiSecret.mockReturnValue('');

    const res = await GET(
      request({ category: 'apple', slug: 'iphone-15' }),
      context()
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    expect(mockGetCachedMerchantByDomain).not.toHaveBeenCalled();
  });
});
