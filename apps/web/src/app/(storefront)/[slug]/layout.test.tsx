import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AD_ATTRIBUTION_CAPTURE_SCRIPT } from '@/components/storefront/ad-attribution-capture';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import {
  getStorefrontShellSnapshot,
  getStorefrontShellSnapshotBase,
} from './storefront-shell-snapshot';

const providerSnapshots: unknown[] = [];
const themeProviderAppearances: unknown[] = [];
const themeProviderDocumentScopes: unknown[] = [];
let themeProviderRenders = 0;
const mockIsValidMerchantIdentifier = vi.hoisted(() =>
  vi.fn<(value: string) => boolean>(() => true)
);
const mockWebMcp = vi.hoisted(() => vi.fn(() => null));
const mockOgabasseyStorefrontLayout = vi.hoisted(() =>
  vi.fn(
    ({
      children,
      preloadHeroLcpImages,
    }: {
      children: ReactNode;
      preloadHeroLcpImages?: boolean;
    }) => (
      <div
        data-preload-hero-lcp={String(Boolean(preloadHeroLcpImages))}
        data-testid="ogabassey-layout"
      >
        {children}
      </div>
    )
  )
);

vi.mock('./storefront-shell-snapshot', () => ({
  getStorefrontShellSnapshotBase: vi.fn(),
  getStorefrontShellSnapshot: vi.fn(),
}));

vi.mock('@/components/storefront/ogabassey/storefront-layout', () => ({
  OgabasseyStorefrontLayout: mockOgabasseyStorefrontLayout,
}));

vi.mock('@/components/storefront/deferred-page-view-tracker', () => ({
  DeferredPageViewTracker: () => <div data-testid="page-view-tracker" />,
}));

vi.mock('@/components/storefront/webmcp-storefront-tools', () => ({
  WebMcpStorefrontTools: mockWebMcp,
}));

vi.mock('@/components/storefront/store-not-published', () => ({
  StoreNotPublished: ({ businessName }: { businessName: string }) => (
    <div>{businessName} unpublished</div>
  ),
}));

vi.mock('@/components/storefront/storefront-theme-provider', () => ({
  StorefrontThemeProvider: ({
    appearance,
    children,
    scopeDocument,
  }: {
    appearance?: unknown;
    children: ReactNode;
    scopeDocument?: unknown;
  }) => {
    themeProviderRenders += 1;
    themeProviderAppearances.push(appearance);
    themeProviderDocumentScopes.push(scopeDocument);
    return <div data-testid="storefront-theme-provider">{children}</div>;
  },
}));

vi.mock('@/hooks/cart/storefront-cart-provider', () => ({
  StorefrontCartProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/hooks/merchant/storefront-merchant-provider', () => ({
  StorefrontMerchantProvider: ({
    children,
    shellSnapshot,
  }: {
    children: ReactNode;
    shellSnapshot: unknown;
  }) => {
    providerSnapshots.push(shellSnapshot);
    return <>{children}</>;
  },
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { slug: string; custom_domain?: string | null }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
  isValidMerchantIdentifier: (value: string) =>
    mockIsValidMerchantIdentifier(value),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function expectThemeProviderNotRendered() {
  expect(themeProviderAppearances).toEqual([]);
  expect(themeProviderDocumentScopes).toEqual([]);
}

const baseMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
  business_name: 'Ogabassey',
  site_title: 'Ogabassey | Buy Gadgets Pay Later',
  site_description: 'Store description',
  site_tagline: 'Store tagline',
  business_type: 'electronics',
  logo_url: null,
  phone: '+2348146978921',
  email: 'hello@ogabassey.com',
  social_media: {},
  brand_colors: undefined,
  business_address: '2 Olaide Tomori St, Ikeja, Lagos',
  payout_currency: 'NGN',
  is_published: true,
  template_id: 'ogabassey',
  plan_tier: 'pro',
  premium_features: null,
  country: 'NG',
  feature_settings: {},
  published_config: null,
  favicon_svg_url: null,
  favicon_png_32_url: null,
  favicon_apple_touch_url: null,
};

const baseShellSnapshot = {
  merchant: {
    id: 'merchant-1',
    user_id: '',
    business_name: 'Ogabassey',
    business_type: 'electronics',
    slug: 'ogabassey',
    custom_domain: 'ogabassey.com',
    template_id: 'ogabassey',
    is_published: true,
  },
  routingMode: 'path' as const,
  basePath: '/ogabassey',
  navigationCategories: [{ name: 'Phones', slug: 'phones' }],
};

const baseShellSnapshotWithoutCategories = {
  merchant: baseShellSnapshot.merchant,
  routingMode: baseShellSnapshot.routingMode,
  basePath: baseShellSnapshot.basePath,
};

const {
  default: StorefrontLayout,
  generateMetadata,
  generateViewport,
  StorefrontLayoutContent,
} = await import('./layout');

describe('storefront layout', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getStorefrontShellSnapshotBase).mockReset();
    vi.mocked(getStorefrontShellSnapshot).mockReset();
    notFound.mockClear();
    mockIsValidMerchantIdentifier.mockReset();
    mockIsValidMerchantIdentifier.mockReturnValue(true);
    mockWebMcp.mockClear();
    mockOgabasseyStorefrontLayout.mockClear();
    providerSnapshots.length = 0;
    themeProviderAppearances.length = 0;
    themeProviderDocumentScopes.length = 0;
    themeProviderRenders = 0;
  });

  it('waits for the shell snapshot and keeps the first-render merchant shell contract observable', async () => {
    const deferredSnapshot = createDeferred<typeof baseShellSnapshot>();

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockReturnValue(
      deferredSnapshot.promise
    );

    const layoutPromise = StorefrontLayoutContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      children: <main>Storefront content</main>,
    });

    let settled = false;
    void layoutPromise.then(() => {
      settled = true;
    });

    await waitFor(() => {
      expect(getStorefrontShellSnapshotBase).toHaveBeenCalledWith('ogabassey');
    });
    expect(getStorefrontShellSnapshot).toHaveBeenCalledWith(
      baseShellSnapshotWithoutCategories
    );

    await Promise.resolve();
    expect(settled).toBe(false);

    deferredSnapshot.resolve(baseShellSnapshot);
    render(await layoutPromise);

    expect(providerSnapshots).toEqual([baseShellSnapshot]);
    expect(screen.getByTestId('ogabassey-layout')).toHaveAttribute(
      'data-preload-hero-lcp',
      'false'
    );
    expect(mockWebMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      }),
      undefined
    );
    expect(themeProviderRenders).toBe(1);
    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
    expect(screen.getByText('Storefront content')).toBeInTheDocument();
  });

  it('keeps generic storefront layouts from owning OgaBassey home hero preloads', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(baseShellSnapshot);

    render(
      await StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        children: <main>Storefront content</main>,
      })
    );

    expect(screen.getByTestId('ogabassey-layout')).toHaveAttribute(
      'data-preload-hero-lcp',
      'false'
    );
    expect(mockOgabasseyStorefrontLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        preloadHeroLcpImages: false,
      }),
      undefined
    );
  });

  it('renders non-OgaBassey storefront layouts without a request-bound bailout', async () => {
    const genericMerchant = {
      ...baseShellSnapshot.merchant,
      business_name: 'Generic Store',
      custom_domain: undefined,
      slug: 'generic-store',
      template_id: 'modern',
    };
    const genericShellSnapshotBase = {
      ...baseShellSnapshotWithoutCategories,
      merchant: genericMerchant,
    };
    const genericShellSnapshot = {
      ...baseShellSnapshot,
      merchant: genericMerchant,
    };

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      genericShellSnapshotBase
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(
      genericShellSnapshot
    );

    render(
      await StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'generic-store' }),
        children: <main>Generic storefront content</main>,
      })
    );

    expect(themeProviderAppearances).toEqual([
      { mode: 'light', variant: 'default' },
    ]);
    expect(screen.getByText('Generic storefront content')).toBeInTheDocument();
  });

  it('renders the neutral static PPR shell before params resolve', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<typeof baseShellSnapshotWithoutCategories>().promise
    );
    const deferredParams = createDeferred<{ slug: string }>();

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      params: deferredParams.promise,
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    expectThemeProviderNotRendered();
    expect(getStorefrontShellSnapshotBase).not.toHaveBeenCalled();
    expect(
      screen.getByRole('status', { name: /loading storefront chrome/i })
    ).toBeInTheDocument();
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toBeTruthy();
    expect(staticShell).toHaveAttribute('data-storefront-shell', '');
    expect(staticShell).toHaveClass('storefront-theme-scope');
    expect(staticShell).toHaveClass('storefront-variant-default');
    expect(staticShell).toHaveClass('storefront-light');
    expect(
      container?.querySelector('.storefront-ppr-static-shell__fallback')
    ).toBeTruthy();
    expect(
      container?.querySelector('.storefront-ppr-static-shell__content')
    ).toBeFalsy();
    expect(screen.queryByText('Storefront content')).not.toBeInTheDocument();

    await act(async () => {
      deferredParams.resolve({ slug: 'generic-store' });
      await deferredParams.promise;
    });

    await waitFor(() => {
      expect(getStorefrontShellSnapshotBase).toHaveBeenCalledWith(
        'generic-store'
      );
    });

    unmount();
  });

  it('uses an explicit OgaBassey appearance for the static fallback', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<typeof baseShellSnapshotWithoutCategories>().promise
    );

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      fallbackAppearance: { mode: 'system', variant: 'ogabassey' },
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    await screen.findByRole('status', { name: /loading storefront chrome/i });

    expectThemeProviderNotRendered();
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toHaveClass('storefront-theme-scope');
    expect(staticShell).toHaveClass('storefront-variant-ogabassey');
    expect(staticShell).toHaveClass('storefront-mode-system');
    expect(
      screen.getByRole('status', { name: /loading storefront chrome/i })
    ).toBeInTheDocument();

    unmount();
  });

  it('renders the ad attribution capture script in the static shell before tenant data resolves', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<typeof baseShellSnapshotWithoutCategories>().promise
    );

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      params: Promise.resolve({ slug: 'ogabassey' }),
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    // The inline capture script must ship with the static shell (outside the
    // dynamic Suspense leg) so fast-bounce ad landings never lose attribution.
    const script = container?.querySelector('script');
    expect(script?.textContent).toBe(AD_ATTRIBUTION_CAPTURE_SCRIPT);
    expect(script?.textContent).toContain('/api/attr');
    expect(script?.textContent).toContain('method:"POST"');

    unmount();
  });

  it('keeps explicit layout loading fallbacks overridable', async () => {
    const fallback = <div>Loading route shell</div>;

    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<typeof baseShellSnapshotWithoutCategories>().promise
    );

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      fallbackAppearance: { mode: 'system', variant: 'ogabassey' },
      params: Promise.resolve({ slug: 'ogabassey' }),
      loadingFallback: fallback,
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    await screen.findByText('Loading route shell');

    expectThemeProviderNotRendered();
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toHaveClass('storefront-variant-ogabassey');
    expect(staticShell).toHaveClass('storefront-mode-system');
    expect(screen.getByText('Loading route shell')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /loading storefront chrome/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Storefront content')).not.toBeInTheDocument();

    unmount();
  });

  it('keeps non-OgaBassey storefronts forced light after the shell resolves', async () => {
    const genericMerchant = {
      ...baseShellSnapshot.merchant,
      business_name: 'Generic Store',
      custom_domain: undefined,
      slug: 'generic-store',
      template_id: 'modern',
    };
    const genericShellSnapshotBase = {
      ...baseShellSnapshotWithoutCategories,
      merchant: genericMerchant,
    };
    const genericShellSnapshot = {
      ...baseShellSnapshot,
      merchant: genericMerchant,
    };

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      genericShellSnapshotBase
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(
      genericShellSnapshot
    );

    const ui = await StorefrontLayoutContent({
      params: Promise.resolve({ slug: 'generic-store' }),
      children: <main>Generic storefront content</main>,
    });

    render(ui);

    expect(themeProviderAppearances).toEqual([
      { mode: 'light', variant: 'default' },
    ]);
  });

  it('uses system appearance for the OgaBassey custom-domain identifier after the shell resolves', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(baseShellSnapshot);

    const ui = await StorefrontLayoutContent({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      children: <main>Storefront content</main>,
    });

    render(ui);

    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
  });

  it('calls notFound directly when the shell snapshot is missing', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(null);

    await expect(
      StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        children: <main>Storefront content</main>,
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
    expect(themeProviderRenders).toBe(0);
    expect(themeProviderAppearances).toEqual([]);
    expect(providerSnapshots).toEqual([]);
  });

  it('calls notFound directly when the full shell snapshot is missing', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(null);

    await expect(
      StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        children: <main>Storefront content</main>,
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
    expect(themeProviderRenders).toBe(0);
    expect(themeProviderAppearances).toEqual([]);
    expect(providerSnapshots).toEqual([]);
  });

  it('renders StoreNotPublished outside development without waiting on category work', async () => {
    const deferredSnapshot = createDeferred<typeof baseShellSnapshot>();

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue({
      ...baseShellSnapshotWithoutCategories,
      merchant: {
        ...baseShellSnapshotWithoutCategories.merchant,
        business_name: 'Draft Store',
        is_published: false,
      },
    });
    vi.mocked(getStorefrontShellSnapshot).mockReturnValue(
      deferredSnapshot.promise
    );

    render(
      await StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'draft-store' }),
        children: <main>Storefront content</main>,
      })
    );

    expect(screen.getByText('Draft Store unpublished')).toBeInTheDocument();
    expect(screen.queryByText('Storefront content')).not.toBeInTheDocument();
    expect(themeProviderRenders).toBe(1);
    expect(themeProviderAppearances).toEqual([
      { mode: 'light', variant: 'default' },
    ]);
    expect(getStorefrontShellSnapshot).not.toHaveBeenCalled();
    expect(providerSnapshots).toEqual([]);
  });
});

describe('storefront layout metadata', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
  });

  it('returns noindex metadata without inherited canonicals when the storefront slug is invalid', async () => {
    mockIsValidMerchantIdentifier.mockReturnValueOnce(false);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'invalid@slug!' }),
    });

    expect(metadata.title).toBe('Store Not Found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
  });

  it('returns noindex metadata without inherited canonicals when the storefront slug is missing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'products' }),
    });

    expect(metadata.title).toBe('Store Not Found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
  });

  it('uses the merchant domain as metadataBase and keeps the OgaBassey app banner on Oga routes', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.metadataBase?.toString()).toBe('https://ogabassey.com/');
    expect(metadata.other).toEqual({
      'apple-itunes-app': 'app-id=6472735367',
    });
  });

  it('does not leak the OgaBassey app banner onto generic storefronts', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      business_name: 'Template Test Store',
      slug: 'template-test-store',
      custom_domain: null,
      site_title: 'Template Test Store',
      template_id: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'template-test-store' }),
    });

    expect(metadata.metadataBase?.toString()).toBe(
      'https://template-test-store.usebaci.com/'
    );
    expect(metadata.other).toBeUndefined();
  });

  it('falls back to the slug-based storefront URL when no custom domain exists', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      business_name: 'Test Store',
      slug: 'test-store',
      custom_domain: null,
      site_title: 'Test Store',
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(metadata.metadataBase?.toString()).toBe(
      'https://test-store.usebaci.com/'
    );
  });

  it('leaves route-level alternates to page metadata', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.alternates).toBeUndefined();
  });

  it('reads google verification from published_config when feature settings omit it', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      slug: 'test-store',
      custom_domain: null,
      site_title: 'Test Store',
      feature_settings: {},
      published_config: {
        google_site_verification: 'google-verification-token',
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(metadata.verification).toEqual({
      google: 'google-verification-token',
    });
  });

  it('keeps the static viewport configuration unchanged', () => {
    expect(generateViewport()).toEqual({
      width: 'device-width',
      initialScale: 1,
    });
  });
});
