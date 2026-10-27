import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OGABASSEY_APPLE_TOUCH_ICON_URL,
  OGABASSEY_DESCRIPTION,
  OGABASSEY_FAVICON_URL,
  OGABASSEY_SOCIAL_IMAGE_URL,
  OGABASSEY_TITLE,
  OGABASSEY_TWITTER_HANDLE,
  OGABASSEY_URL,
} from '@/config/ogabassey';
import { getRequestScopedMerchant } from '@/lib/cached-data';

const mockResolveOgabasseyHomeHeroShell = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(null))
);

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock('@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: () => mockResolveOgabasseyHomeHeroShell(),
}));

vi.mock('@/lib/validation', () => ({
  isValidMerchantIdentifier: () => true,
}));

const baseMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
  business_name: 'Ogabassey',
  site_title: 'Ogabassey - Official Online Store',
  site_tagline: '',
  site_description: '',
  business_type: 'electronics',
  logo_url: 'https://cdn.example.com/logo.svg',
  social_media: {},
  country: 'NG',
  is_published: true,
};

const { generateMetadata } = await import('./page');

describe('storefront homepage metadata', () => {
  beforeEach(() => {
    mockResolveOgabasseyHomeHeroShell.mockClear();
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
  });

  it('emits the static OgaBassey metadata from the dynamic home route', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(getRequestScopedMerchant).toHaveBeenCalledWith('ogabassey');
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.title).toEqual({ absolute: OGABASSEY_TITLE });
    expect(metadata.description).toBe(OGABASSEY_DESCRIPTION);
    expect(metadata.applicationName).toBe('OgaBassey');
    expect(metadata.authors).toEqual([{ name: 'OgaBassey' }]);
    expect(metadata.keywords).toEqual([
      'Buy Smartphones in Nigeria',
      'Buy Laptops in Nigeria',
      'iPhone Price in Nigeria',
      'Samsung Price in Nigeria',
      'PlayStation 5 Nigeria',
      'MacBook Nigeria',
      'Gadget Store Lagos',
      'OgaBassey',
      'Swap Phones Lagos',
    ]);
    expect(metadata.alternates).toEqual({
      canonical: OGABASSEY_URL,
      languages: {
        'en-NG': OGABASSEY_URL,
        'x-default': OGABASSEY_URL,
      },
    });
    expect(metadata.openGraph).toEqual(
      expect.objectContaining({
        images: [
          {
            alt: 'OgaBassey storefront preview',
            height: 900,
            url: OGABASSEY_SOCIAL_IMAGE_URL,
            width: 1440,
          },
        ],
      })
    );
    expect(metadata.twitter).toEqual(
      expect.objectContaining({
        images: [OGABASSEY_SOCIAL_IMAGE_URL],
        site: OGABASSEY_TWITTER_HANDLE,
      })
    );
    expect(metadata.icons).toEqual({
      apple: OGABASSEY_APPLE_TOUCH_ICON_URL,
      icon: OGABASSEY_FAVICON_URL,
      shortcut: OGABASSEY_FAVICON_URL,
    });
  });

  it('uses the same static OgaBassey metadata for the local custom-domain route identifier', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    });

    expect(getRequestScopedMerchant).toHaveBeenCalledWith('ogabassey.com');
    expect(metadata.alternates).toEqual(
      expect.objectContaining({
        canonical: OGABASSEY_URL,
      })
    );
  });

  it('omits Nigerian hreflang for storefronts outside Nigeria', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      slug: 'ghana-store',
      custom_domain: 'ghana.example.com',
      country: 'GH',
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ghana-store' }),
    });

    expect(metadata.alternates).toEqual({
      canonical: 'https://ghana.example.com',
      languages: {
        'x-default': 'https://ghana.example.com',
      },
    });
  });

  it('does not leak OgaBassey keywords into generic storefront metadata', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      business_name: 'Ada Fashion',
      custom_domain: 'ada-fashion.example.com',
      site_title: 'Ada Fashion',
      slug: 'ada-fashion',
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ada-fashion' }),
    });

    expect(metadata.title).toEqual({ absolute: 'Ada Fashion' });
    expect(metadata.keywords).toBeUndefined();
  });

  it('omits an unrelated Twitter handle from generic storefront metadata', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      business_name: 'Ada Fashion',
      custom_domain: 'ada-fashion.example.com',
      site_title: 'Ada Fashion',
      slug: 'ada-fashion',
      social_media: { twitter: '@sxgtow' },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ada-fashion' }),
    });

    expect(metadata.twitter).not.toHaveProperty('site');
    expect(mockResolveOgabasseyHomeHeroShell).not.toHaveBeenCalled();
  });

  it('warms and awaits the OgaBassey home hero shell alongside merchant resolution on the canonical domain', async () => {
    let resolveMerchant!: (
      value: Awaited<ReturnType<typeof getRequestScopedMerchant>>
    ) => void;
    let resolveHeroShell!: (value: null) => void;
    let settled = false;

    vi.mocked(getRequestScopedMerchant).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMerchant = resolve;
        })
    );
    mockResolveOgabasseyHomeHeroShell.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHeroShell = resolve;
        })
    );

    const metadataPromise = generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();

    expect(mockResolveOgabasseyHomeHeroShell).toHaveBeenCalledOnce();

    resolveMerchant(null);
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveHeroShell(null);
    await metadataPromise;
    expect(settled).toBe(true);
  });

  it('warms the hero shell without blocking metadata on the /ogabassey path route', async () => {
    mockResolveOgabasseyHomeHeroShell.mockImplementationOnce(
      () => new Promise(() => {})
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(mockResolveOgabasseyHomeHeroShell).toHaveBeenCalledOnce();
    expect(metadata.title).toEqual({ absolute: OGABASSEY_TITLE });
  });

  it('propagates Next.js framework interrupts rethrown by the hero shell lookup', async () => {
    const frameworkInterrupt = new Error('NEXT_PRERENDER_INTERRUPTED');
    mockResolveOgabasseyHomeHeroShell.mockRejectedValueOnce(frameworkInterrupt);

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    ).rejects.toThrow('NEXT_PRERENDER_INTERRUPTED');
  });
});
