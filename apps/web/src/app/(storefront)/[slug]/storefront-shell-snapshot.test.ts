import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRootDomain } from '@/env';
import { getStorefrontNavigationCategories } from '@/lib/cached-categories';
import { getRequestScopedMerchant } from '@/lib/cached-data';

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

const baseMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  custom_domain: 'ogabassey.com',
  site_title: 'Ogabassey',
  site_tagline: 'Store tagline',
  site_description: 'Store description',
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

  it('returns path-routed shell data with a slug-based basePath on first render', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
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

  it('returns domain-routed shell data with an empty basePath on first render', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    vi.mocked(getStorefrontNavigationCategories).mockResolvedValue([
      { name: 'Phones', slug: 'phones' },
    ]);
    mockHeaders.mockResolvedValue(new Headers([['x-custom-domain', '1']]));

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');
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
  });

  it('does not read request headers when the storefront identifier is already a domain', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );

    const shellSnapshotBase =
      await getStorefrontShellSnapshotBase('ogabassey.com');

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'domain',
      basePath: '',
    });
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it('treats slug subdomains as domain-routed even without x-merchant headers', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    mockHeaders.mockResolvedValue(
      new Headers([['host', 'ogabassey.usebaci.com']])
    );

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'domain',
      basePath: '',
    });
  });

  it('uses the configured root domain for slug subdomain routing', async () => {
    vi.mocked(getRootDomain).mockReturnValue('shops.example');
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    mockHeaders.mockResolvedValue(
      new Headers([['host', 'ogabassey.shops.example']])
    );

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'domain',
      basePath: '',
    });
  });

  it('rejects confusable host suffixes when inferring slug subdomain routing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    mockHeaders.mockResolvedValue(
      new Headers([['host', 'ogabassey.usebaci.com.attacker.tld']])
    );

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'path',
      basePath: '/ogabassey',
    });
  });

  it('parses forwarded host lists when host is unavailable', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    mockHeaders.mockResolvedValue(
      new Headers([
        ['x-forwarded-host', 'ogabassey.usebaci.com:443, proxy.local'],
      ])
    );

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'domain',
      basePath: '',
    });
  });

  it('prefers host over forwarded host for slug subdomain routing inference', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'usebaci.com'],
        ['x-forwarded-host', 'ogabassey.usebaci.com'],
      ])
    );

    const shellSnapshotBase = await getStorefrontShellSnapshotBase('ogabassey');

    expect(shellSnapshotBase).toMatchObject({
      routingMode: 'path',
      basePath: '/ogabassey',
    });
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
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

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
