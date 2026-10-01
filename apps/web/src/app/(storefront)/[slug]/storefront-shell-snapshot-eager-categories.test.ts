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

describe('getStorefrontShellSnapshot eager categories', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getStorefrontNavigationCategories).mockReset();
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers());
    vi.mocked(getRootDomain).mockReturnValue('usebaci.com');
  });

  it('can resolve the minimal shell snapshot without waiting on navigation categories', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      is_published: false,
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const snapshot = await getStorefrontShellSnapshotBase('ogabassey');

    expect(snapshot).toMatchObject({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: false,
      },
      routingMode: 'path',
      basePath: '/ogabassey',
    });
    expect(getStorefrontNavigationCategories).not.toHaveBeenCalled();
  });

  it('adopts a pre-started categories read when the merchant id matches', async () => {
    vi.mocked(getStorefrontNavigationCategories).mockResolvedValue([
      { name: 'Phones', slug: 'phones' },
    ]);
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

    const snapshot = await getStorefrontShellSnapshot(shellSnapshotBase, {
      merchantId: 'merchant-1',
      categories: Promise.resolve([{ name: 'Early', slug: 'early' }]),
    });

    expect(snapshot).toMatchObject({
      navigationCategories: [{ name: 'Early', slug: 'early' }],
    });
    expect(getStorefrontNavigationCategories).not.toHaveBeenCalled();
  });

  it('refetches by the resolved id when the pre-started read assumed wrong', async () => {
    vi.mocked(getStorefrontNavigationCategories).mockResolvedValue([
      { name: 'Phones', slug: 'phones' },
    ]);
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

    const snapshot = await getStorefrontShellSnapshot(shellSnapshotBase, {
      merchantId: 'stale-merchant-id',
      categories: Promise.resolve([{ name: 'Early', slug: 'early' }]),
    });

    expect(snapshot).toMatchObject({
      navigationCategories: [{ name: 'Phones', slug: 'phones' }],
    });
    expect(getStorefrontNavigationCategories).toHaveBeenCalledWith(
      'merchant-1'
    );
  });
});
