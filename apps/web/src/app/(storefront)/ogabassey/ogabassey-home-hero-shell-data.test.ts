import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCachedMerchant = vi.hoisted(() => vi.fn());
vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: (...args: unknown[]) => mockGetCachedMerchant(...args),
}));

const mockLoadLaunchProducts = vi.hoisted(() => vi.fn());
vi.mock('./ogabassey-home-launch-products', () => ({
  loadOgabasseyLaunchProducts: (...args: unknown[]) =>
    mockLoadLaunchProducts(...args),
}));

const mockBuildLaunchSlides = vi.hoisted(() => vi.fn());
vi.mock(
  '@/components/storefront/ogabassey/components/build-launch-slides',
  () => ({
    buildLaunchSlides: (...args: unknown[]) => mockBuildLaunchSlides(...args),
  })
);

vi.mock('next/navigation', () => ({
  unstable_rethrow: vi.fn(),
}));

// Simulates the react-server bundle's `cache()`: the client bundle vitest
// resolves exports `cache` as a passthrough, so the memo would never engage
// here. React's own per-request invalidation is upstream's contract — this
// mock only proves both owners attach to one shared promise.
vi.mock('react', () => ({
  cache: (fn: (...args: never[]) => Promise<unknown>) => {
    let shared: Promise<unknown> | undefined;
    return (...args: never[]) => {
      if (!shared) {
        shared = fn(...args);
      }
      return shared;
    };
  },
}));

/**
 * The resolver is request-memoized via React `cache()`, so each test imports
 * a fresh module (after `vi.resetModules()` in `beforeEach`) to get an
 * unpolluted memo. The `vi.mock` factories above persist across resets.
 */
async function loadResolver() {
  const mod = await import('./ogabassey-home-hero-shell-data');
  return mod.resolveOgabasseyHomeHeroShell;
}

const SLIDE = {
  kind: 'product',
  id: 'p1',
  name: 'Tecno Spark 40 Pro',
  priceLabel: '₦250,000',
  href: '/smartphones/tecno-spark-40-pro',
  imageUrl: 'https://cdn.ogabassey.com/core-assets/products/tecno.avif',
  imageAlt: 'Tecno Spark 40 Pro',
  ctaLabel: 'Shop now',
};

describe('resolveOgabasseyHomeHeroShell', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetCachedMerchant.mockResolvedValue({
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
    });
    mockLoadLaunchProducts.mockResolvedValue([{ id: 'p1' }]);
    mockBuildLaunchSlides.mockReturnValue([SLIDE]);
  });

  it('builds origin-independent canonical links for every OgaBassey alias', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    const shell = await resolveOgabasseyHomeHeroShell();

    expect(mockGetCachedMerchant).toHaveBeenCalledWith('ogabassey');
    // Hero prices format in the merchant's resolved currency (NGN for the
    // ogabassey merchant), keeping them consistent with the grid feed.
    expect(mockLoadLaunchProducts).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({ code: 'NGN' })
    );
    expect(mockBuildLaunchSlides).toHaveBeenCalledWith(
      [{ id: 'p1' }],
      'https://ogabassey.com'
    );
    expect(shell).toEqual({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [SLIDE],
    });
  });

  it('returns null when the merchant is missing', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    mockGetCachedMerchant.mockResolvedValue(null);

    await expect(resolveOgabasseyHomeHeroShell()).resolves.toBeNull();
    expect(mockLoadLaunchProducts).not.toHaveBeenCalled();
  });

  it('returns an unpublished result when publication status is null', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    mockGetCachedMerchant.mockResolvedValue({
      id: 'merchant-1',
      is_published: null,
    });

    await expect(resolveOgabasseyHomeHeroShell()).resolves.toEqual({
      status: 'unpublished',
    });
    expect(mockLoadLaunchProducts).not.toHaveBeenCalled();
  });

  it('returns an unpublished result when the merchant is unpublished', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    mockGetCachedMerchant.mockResolvedValue({
      id: 'merchant-1',
      is_published: false,
    });

    await expect(resolveOgabasseyHomeHeroShell()).resolves.toEqual({
      status: 'unpublished',
    });
    expect(mockLoadLaunchProducts).not.toHaveBeenCalled();
  });

  it('keeps a published empty state when no launch slides can be built', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    mockBuildLaunchSlides.mockReturnValue([]);

    await expect(resolveOgabasseyHomeHeroShell()).resolves.toEqual({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [],
    });
  });

  it('fails open to null when a cached lookup throws (shell must not break)', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetCachedMerchant.mockRejectedValue(new Error('cache backend down'));

    await expect(resolveOgabasseyHomeHeroShell()).resolves.toBeNull();
  });

  it('rethrows a Next-internal error instead of swallowing it (unstable_rethrow contract)', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    const { unstable_rethrow } = await import('next/navigation');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const nextInternalError = new Error('NEXT_HTTP_ERROR_FALLBACK;404');
    mockGetCachedMerchant.mockRejectedValue(nextInternalError);
    vi.mocked(unstable_rethrow).mockImplementationOnce((error: unknown) => {
      throw error;
    });

    await expect(resolveOgabasseyHomeHeroShell()).rejects.toThrow(
      nextInternalError
    );
  });

  it('resolves to null once the cached lookup exceeds the SHELL_LOOKUP_BUDGET_MS budget', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    vi.useFakeTimers();
    try {
      // Never resolves within the test — the budget race must win instead.
      mockGetCachedMerchant.mockReturnValue(
        new Promise<never>(() => {
          // Intentionally left pending: exercises the SHELL_LOOKUP_BUDGET_MS
          // timeout race rather than a resolved/rejected merchant lookup.
        })
      );

      const shellPromise = resolveOgabasseyHomeHeroShell();
      await vi.advanceTimersByTimeAsync(500);

      await expect(shellPromise).resolves.toBeNull();
      expect(mockBuildLaunchSlides).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one outcome across twin calls in the same render (no budget-edge split)', async () => {
    const resolveOgabasseyHomeHeroShell = await loadResolver();
    // Slow leg (still inside the 500ms budget): without request memoization
    // each twin would run its own race and fetch; with it, the second call
    // attaches to the first caller's promise.
    mockGetCachedMerchant.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                custom_domain: 'ogabassey.com',
                id: 'merchant-1',
                is_published: true,
                slug: 'ogabassey',
              }),
            100
          )
        )
    );

    const [first, second] = await Promise.all([
      resolveOgabasseyHomeHeroShell(),
      resolveOgabasseyHomeHeroShell(),
    ]);

    expect(second).toBe(first);
    expect(first?.status).toBe('published');
    expect(mockGetCachedMerchant).toHaveBeenCalledTimes(1);
  });
});
