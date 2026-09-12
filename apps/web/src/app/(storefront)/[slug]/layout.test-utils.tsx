import type { ReactNode } from 'react';
import { expect, vi } from 'vitest';

export const providerSnapshots: unknown[] = [];
export const themeProviderAppearances: unknown[] = [];
export const themeProviderDocumentScopes: unknown[] = [];
export let themeProviderRenders = 0;
const getRequestScopedMerchant = vi.hoisted(() => vi.fn());
const getStorefrontShellSnapshot = vi.hoisted(() => vi.fn());
const getStorefrontShellSnapshotBase = vi.hoisted(() => vi.fn());
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

export {
  getRequestScopedMerchant,
  getStorefrontShellSnapshot,
  getStorefrontShellSnapshotBase,
  mockIsValidMerchantIdentifier,
  mockOgabasseyStorefrontLayout,
  mockWebMcp,
};

vi.mock('./storefront-shell-snapshot', () => ({
  getStorefrontShellSnapshotBase,
  getStorefrontShellSnapshot,
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
  getRequestScopedMerchant,
}));

export const notFound = vi.fn(() => {
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

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

export function expectThemeProviderNotRendered() {
  expect(themeProviderAppearances).toEqual([]);
  expect(themeProviderDocumentScopes).toEqual([]);
}

export const baseMerchant = {
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

export const baseShellSnapshot = {
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

export const baseShellSnapshotWithoutCategories = {
  merchant: baseShellSnapshot.merchant,
  routingMode: baseShellSnapshot.routingMode,
  basePath: baseShellSnapshot.basePath,
};
export type BaseShellSnapshotWithoutCategories =
  typeof baseShellSnapshotWithoutCategories;

export const {
  default: StorefrontLayout,
  generateMetadata,
  generateViewport,
  StorefrontLayoutContent,
} = await import('./layout');

export function resetStorefrontLayoutTestState() {
  getRequestScopedMerchant.mockReset();
  getStorefrontShellSnapshotBase.mockReset();
  getStorefrontShellSnapshot.mockReset();
  notFound.mockClear();
  mockIsValidMerchantIdentifier.mockReset();
  mockIsValidMerchantIdentifier.mockReturnValue(true);
  mockWebMcp.mockClear();
  mockOgabasseyStorefrontLayout.mockClear();
  providerSnapshots.length = 0;
  themeProviderAppearances.length = 0;
  themeProviderDocumentScopes.length = 0;
  themeProviderRenders = 0;
}
