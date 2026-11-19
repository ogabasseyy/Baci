import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRootDomain } from '@/env';
import { getStorefrontNavigationCategories } from '@/lib/cached-categories';
import {
  type CachedMerchant,
  getRequestScopedMerchant,
} from '@/lib/cached-data';

vi.mock('@/env', () => ({
  getRootDomain: vi.fn(() => 'usebaci.com'),
}));

vi.mock('@/lib/cached-categories', () => ({
  getStorefrontNavigationCategories: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));

const baseMerchant: CachedMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  custom_domain: 'ogabassey.com',
  site_title: 'Ogabassey',
  site_tagline: 'Store tagline',
  site_description: 'Store description',
  logo_url: '',
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
  favicon_svg_url: undefined,
  favicon_png_32_url: undefined,
  favicon_apple_touch_url: undefined,
};

const { getStorefrontShellSnapshot, getStorefrontShellSnapshotBase } =
  await import('./storefront-shell-snapshot');

describe('getStorefrontShellSnapshot', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getStorefrontNavigationCategories).mockReset();
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers());
    vi.mocked(getRootDomain).mockReturnValue('usebaci.com');
  });

  it.each([
    [
      'active paid plan',
      { plan_tier: 'pro', plan_expires_at: null },
      'pixel-shell',
    ],
    [
      'expired plan',
      { plan_tier: 'pro', plan_expires_at: '2000-01-01T00:00:00Z' },
      null,
    ],
    ['free plan', { plan_tier: 'free', plan_expires_at: null }, null],
    [
      'explicit grant',
      { plan_tier: 'free', premium_features: ['growth_integrations'] },
      'pixel-shell',
    ],
  ])('resolves only the public entitled Pixel ID for %s', async (_name, plan, expected) => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      ...plan,
      feature_settings: {
        chatgpt_pixel_id: ' pixel-shell ',
        capi_key: 'never-public',
      },
    });
    vi.mocked(getStorefrontNavigationCategories).mockResolvedValue([]);
    const base = await getStorefrontShellSnapshotBase('ogabassey');
    expect(base?.chatgptPixelId).toBe(expected);
    if (!base) throw new Error('Expected a resolved merchant snapshot');
    const snapshot = await getStorefrontShellSnapshot(base);
    expect(snapshot?.chatgptPixelId).toBe(expected);
    expect(JSON.stringify(snapshot)).not.toContain('never-public');
  });

  it('returns path-routed shell data with a slug-based basePath on first render', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(baseMerchant);
    vi.mocked(getStorefrontNavigationCategories).mockResolvedValue([
      { name: 'Phones', slug: 'phones' },
    ]);

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');
    expect(shellSnapshotBase).not.toBeNull();
    if (!shellSnapshotBase) {
      throw new Error('Expected shellSnapshotBase to be resolved');
    }
    const snapshot = await getStorefrontShellSnapshot(shellSnapshotBase);

    expect(snapshot).toMatchObject({
      merchant: {
        id: 'merchant-1',
        user_id: '',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
      },
      routingMode: 'path',
      basePath: '/ogabassey',
      navigationCategories: [{ name: 'Phones', slug: 'phones' }],
    });
  });

  it('returns domain-routed shell data with an empty basePath for domain identifiers without reading headers', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(baseMerchant);
    vi.mocked(getStorefrontNavigationCategories).mockResolvedValue([
      { name: 'Phones', slug: 'phones' },
    ]);

    const shellSnapshotBase =
      await getStorefrontShellSnapshotBase('ogabassey.com');
    expect(shellSnapshotBase).not.toBeNull();
    if (!shellSnapshotBase) {
      throw new Error('Expected shellSnapshotBase to be resolved');
    }
    const snapshot = await getStorefrontShellSnapshot(shellSnapshotBase);

    expect(snapshot).toMatchObject({
      routingMode: 'domain',
      basePath: '',
      navigationCategories: [{ name: 'Phones', slug: 'phones' }],
      merchant: {
        slug: 'ogabassey',
      },
    });
    expect(getStorefrontNavigationCategories).toHaveBeenCalledWith(
      'merchant-1'
    );
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it('does not read request headers for slug identifiers either', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(baseMerchant);

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'path',
      basePath: '/ogabassey',
    });
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it('returns domain-routed shell data for subdomain host identifiers rewritten by proxy', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(baseMerchant);

    const shellSnapshotBase = await getStorefrontShellSnapshotBase(
      'ogabassey.usebaci.com'
    );

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'domain',
      basePath: '',
    });
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it('expands a precomputed base snapshot without repeating merchant lookup work', async () => {
    const shellSnapshotBase = {
      merchant: {
        id: 'merchant-1',
        user_id: '',
        business_name: 'Ogabassey',
        business_type: 'electronics',
        slug: 'ogabassey',
        is_published: true,
      },
      routingMode: 'path' as const,
      basePath: '/ogabassey',
    };
    vi.mocked(getStorefrontNavigationCategories).mockResolvedValue([
      { name: 'Phones', slug: 'phones' },
    ]);

    const snapshot = await getStorefrontShellSnapshot(shellSnapshotBase);

    expect(snapshot).toEqual({
      ...shellSnapshotBase,
      navigationCategories: [{ name: 'Phones', slug: 'phones' }],
    });
    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
  });

  it('redacts secret feature settings before serializing shell merchant data', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      feature_settings: {
        blog_enabled: true,
        custom_settings: {
          google_merchant_id: '112524323',
          paypal_secret_key: 'server-only-paypal-secret',
        },
        tiktok_access_token: 'server-only-tiktok-token',
      },
    });

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');

    expect(shellSnapshotBase?.merchant.feature_settings).toEqual({
      blog_enabled: true,
      custom_settings: {
        google_merchant_id: '112524323',
      },
    });
    expect(JSON.stringify(shellSnapshotBase)).not.toContain('server-only');
  });
});
