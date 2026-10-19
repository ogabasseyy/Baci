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

const claim = {
  attempts: 1,
  claim_token: '11111111-1111-4111-8111-111111111111',
  generation: 2,
  merchant_id: '22222222-2222-4222-8222-222222222222',
  product_slugs: ['cache-phone', '33333333-3333-4333-8333-333333333333'],
  related_identifiers: ['ogabassey', 'ogabassey.com'],
  target_id: 'ogabassey',
  target_kind: 'storefront_slug' as const,
};
describe('drainStorefrontCacheInvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    mocks.products.mockReturnValue(true);
    mocks.vercel.mockResolvedValue({ ok: true, reason: 'deleted' });
    mocks.cloudflare.mockResolvedValue({ ok: true });
  });
  it('confirms Next then Vercel then Cloudflare in strict order', async () => {
    await expect(drainStorefrontCacheInvalidation(claim)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.revalidateTag).toHaveBeenCalled();
    expect(mocks.revalidateTag.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.vercel.mock.invocationCallOrder[0]
    );
    expect(mocks.vercel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cloudflare.mock.invocationCallOrder[0]
    );
    expect(mocks.cloudflare).toHaveBeenCalledWith([
      'ogabassey.com',
      'www.ogabassey.com',
    ]);
    expect(mocks.vercel).toHaveBeenCalledWith(
      expect.arrayContaining([
        'merchant-ogabassey.com',
        'product-lcp-image-22222222-2222-4222-8222-222222222222-cache-phone',
      ]),
      { mode: 'delete' }
    );
    expect(mocks.vercel).not.toHaveBeenCalledWith(
      expect.arrayContaining(['product-lcp-image'])
    );
    expect(mocks.revalidateTag).not.toHaveBeenCalledWith('product-lcp-image', {
      expire: 0,
    });
  });
  it('coalesces concurrent duplicate events without retaining settled provider results', async () => {
    let releaseVercel!: (value: { ok: true; reason: 'deleted' }) => void;
    mocks.vercel.mockReturnValue(
      new Promise((resolve) => {
        releaseVercel = resolve;
      })
    );
    const first = drainStorefrontCacheInvalidation(claim);
    const second = drainStorefrontCacheInvalidation({
      ...claim,
      claim_token: '11111111-1111-4111-8111-111111111112',
    });
    await Promise.resolve();
    expect(mocks.vercel).toHaveBeenCalledTimes(1);
    releaseVercel({ ok: true, reason: 'deleted' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(mocks.cloudflare).toHaveBeenCalledTimes(1);
    await expect(drainStorefrontCacheInvalidation(claim)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.vercel).toHaveBeenCalledTimes(2);
    expect(mocks.cloudflare).toHaveBeenCalledTimes(2);
  });

  it('bugfix: does not coalesce Cloudflare behind a different Vercel tag set', async () => {
    let releaseFirstCloudflare!: (value: { ok: true }) => void;
    let firstCloudflareStarted = false;
    mocks.cloudflare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          firstCloudflareStarted = true;
          releaseFirstCloudflare = resolve;
        })
    );
    const first = drainStorefrontCacheInvalidation(claim);
    await vi.waitFor(() => {
      expect(firstCloudflareStarted).toBe(true);
    });
    expect(mocks.cloudflare).toHaveBeenCalledTimes(1);
    const second = drainStorefrontCacheInvalidation({
      ...claim,
      product_slugs: ['other-phone'],
    });
    await vi.waitFor(() => {
      expect(mocks.cloudflare).toHaveBeenCalledTimes(2);
    });
    releaseFirstCloudflare({ ok: true });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(mocks.vercel).toHaveBeenCalledTimes(2);
  });
  it('shares mixed provider failure outcomes while preserving retry visibility', async () => {
    let releaseVercel!: (value: { ok: true; reason: 'deleted' }) => void;
    mocks.vercel.mockReturnValue(
      new Promise((resolve) => {
        releaseVercel = resolve;
      })
    );
    const first = drainStorefrontCacheInvalidation(claim);
    const second = drainStorefrontCacheInvalidation(claim);
    await Promise.resolve();
    expect(mocks.vercel).toHaveBeenCalledTimes(1);
    mocks.cloudflare.mockResolvedValue({
      ok: false,
      errorCode: 'cloudflare_http_429',
      retryAfterSeconds: 120,
    });
    releaseVercel({ ok: true, reason: 'deleted' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        errorCode: 'cloudflare_http_429',
        ok: false,
        retryAfterSeconds: 120,
      },
      {
        errorCode: 'cloudflare_http_429',
        ok: false,
        retryAfterSeconds: 120,
      },
    ]);
    expect(mocks.cloudflare).toHaveBeenCalledTimes(1);
  });
  it('completes a non-policy storefront without calling Cloudflare', async () => {
    const nonPolicyClaim = {
      ...claim,
      related_identifiers: ['shop-one', 'shop.example.com'],
      target_id: 'shop-one',
    };
    await expect(
      drainStorefrontCacheInvalidation(nonPolicyClaim)
    ).resolves.toEqual({ ok: true });
    expect(mocks.vercel).toHaveBeenCalled();
    expect(mocks.cloudflare).not.toHaveBeenCalled();
  });
  it('resolves a policy custom-domain target to every policy hostname', async () => {
    await expect(
      drainStorefrontCacheInvalidation({
        ...claim,
        target_id: 'ogabassey.com',
        target_kind: 'storefront_hostname',
      })
    ).resolves.toEqual({ ok: true });
    expect(mocks.cloudflare).toHaveBeenCalledWith([
      'ogabassey.com',
      'www.ogabassey.com',
    ]);
  });
  it('stale-while-revalidates exact product tags without duplicating the ordered Cloudflare follow-up', async () => {
    mocks.vercel.mockResolvedValueOnce({ ok: true, reason: 'invalidated' });
    await expect(
      drainStorefrontCacheInvalidation({
        ...claim,
        product_slugs: [],
        related_identifiers: ['ogabassey', 'ogabassey.com'],
        target_id: 'renamed-phone',
        target_kind: 'storefront_product',
      })
    ).resolves.toEqual({ ok: true });
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      'product-22222222-2222-4222-8222-222222222222-renamed-phone',
      'products'
    );
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      'product-lcp-image-22222222-2222-4222-8222-222222222222-renamed-phone',
      'products'
    );
    expect(mocks.products).not.toHaveBeenCalled();
    expect(mocks.categories).not.toHaveBeenCalled();
    expect(mocks.cloudflare).not.toHaveBeenCalled();
    expect(mocks.vercel).toHaveBeenCalledWith(
      [
        'product-22222222-2222-4222-8222-222222222222-renamed-phone',
        'product-lcp-image-22222222-2222-4222-8222-222222222222-renamed-phone',
      ],
      { mode: 'invalidate' }
    );
  });
  it.each([
    [{ ok: true, reason: 'deleted' }, 'vercel_deleted'],
    [{ ok: false, reason: 'timeout' }, 'vercel_timeout'],
  ] as const)('rejects an exact product purge that is not confirmed as invalidated', async (vercelResult, errorCode) => {
    mocks.vercel.mockResolvedValueOnce(vercelResult);
    await expect(
      drainStorefrontCacheInvalidation({
        ...claim,
        product_slugs: [],
        target_id: 'renamed-phone',
        target_kind: 'storefront_product',
      })
    ).resolves.toEqual({ errorCode, ok: false });
    expect(mocks.cloudflare).not.toHaveBeenCalled();
  });
  it.each([
    'vercel',
    'cloudflare',
  ] as const)('does not share a pending %s purge across generations', async (provider) => {
    let release!: () => void;
    mocks[provider].mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              provider === 'vercel'
                ? { ok: true, reason: 'deleted' }
                : { ok: true }
            );
        })
    );
    const first = drainStorefrontCacheInvalidation(claim);
    // Allow the first drain to reach either provider without resolving it.
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    const second = drainStorefrontCacheInvalidation({
      ...claim,
      generation: claim.generation + 1,
    });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    const callsBeforeRelease = mocks[provider].mock.calls.length;
    release();
    await Promise.all([first, second]);
    expect(callsBeforeRelease).toBe(2);
  });
  it('times out a delayed Vercel deletion before reaching Cloudflare', async () => {
    mocks.vercel.mockReturnValue(new Promise(() => undefined));
    await expect(
      drainStorefrontCacheInvalidation(claim, { vercelTimeoutMs: 5 })
    ).resolves.toEqual({ errorCode: 'vercel_timeout', ok: false });
    expect(mocks.cloudflare).not.toHaveBeenCalled();
  });
  it('never reaches Cloudflare when Vercel deletion is unconfirmed', async () => {
    mocks.vercel.mockResolvedValue({ ok: false, reason: 'request_failed' });
    await expect(drainStorefrontCacheInvalidation(claim)).resolves.toEqual({
      errorCode: 'vercel_request_failed',
      ok: false,
    });
    expect(mocks.cloudflare).not.toHaveBeenCalled();
  });
  it('propagates bounded Cloudflare throttling without exposing provider data', async () => {
    mocks.cloudflare.mockResolvedValue({
      ok: false,
      errorCode: 'cloudflare_http_429',
      retryAfterSeconds: 120,
    });
    await expect(drainStorefrontCacheInvalidation(claim)).resolves.toEqual({
      errorCode: 'cloudflare_http_429',
      ok: false,
      retryAfterSeconds: 120,
    });
  });
});
