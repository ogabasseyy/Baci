import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockHost = 'localhost:3000';
let mockBlogEnabled = true;
let mockRepairsEnabled = false;
let mockBusinessType: string | null = 'electronics';

vi.mock('next/headers', () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((name: string) => {
        if (name.toLowerCase() === 'host') return mockHost;
        return null;
      }),
    })
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(async () => ({
    id: 'merchant-1',
    business_type: mockBusinessType,
    feature_settings: {
      blog_enabled: mockBlogEnabled,
      repairs_catalog_enabled: mockRepairsEnabled,
    },
  })),
}));

describe('robots crawl policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHost = 'localhost:3000';
    mockBlogEnabled = true;
    mockRepairsEnabled = false;
    mockBusinessType = 'electronics';
    delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  });

  it('uses storefront disallows for merchant subdomains', async () => {
    const { default: robots, STOREFRONT_DISALLOWED_PATHS } = await import(
      './robots'
    );
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'ogabassey.usebaci.com';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;
    const disallows = defaultRule.disallow as string[];

    expect(disallows).toEqual([...STOREFRONT_DISALLOWED_PATHS]);
    expect(disallows).toContain('/api/');
    expect(disallows).toContain('/checkout/');
    expect(disallows).toContain('/cart');
    expect(disallows).toContain('/wishlist');
    expect(disallows).toContain('/account/');
    expect(disallows).toContain('/my-account/');
    expect(disallows).toContain('/delete-account');
    expect(disallows).toContain('/receipts');
    expect(disallows).toContain('/wallet');
    expect(disallows).toContain('/order-success');
    expect(disallows).toContain('/track-order');
    expect(disallows).toContain('/unlock-orders');
    expect(disallows).toContain('/member-status');
    expect(disallows).toContain('/reviews');
    expect(disallows).toContain('/repair/status');
    expect(disallows).toContain('/pages/rewards');
    expect(disallows).toContain('/blog/shopdetail/');
    expect(disallows).toContain('/blog/zhHant/');
    expect(disallows).toContain('/blog/product/');
    expect(disallows).toContain('/*?*wc-ajax=*');
    expect(disallows).toContain('/*?*add-to-cart=*');
    expect(disallows).not.toContain('/dashboard/');
    expect(disallows).not.toContain('/onboarding/');
    expect(disallows).not.toContain('/auth/');

    for (const allowedPath of [
      '/blog',
      '/blog/',
      '/blog/category/',
      '/blog/author/',
      '/products',
      '/faq',
      '/repairs',
      '/swap',
      '/search',
      '/*?*sort=*',
      '/*?*search=*',
      '/*?*page=*',
      '/*?*variant_id=*',
      '/*?*offer_id=*',
      '/*?*match_base=*',
    ]) {
      expect(disallows).not.toContain(allowedPath);
    }
  });

  it('uses storefront disallows for custom domains', async () => {
    const { default: robots, STOREFRONT_DISALLOWED_PATHS } = await import(
      './robots'
    );
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'shop.ogabassey.com';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;
    const disallows = defaultRule.disallow as string[];

    expect(disallows).toEqual([...STOREFRONT_DISALLOWED_PATHS]);
    expect(disallows).toContain('/api/');
    expect(disallows).not.toContain('/_next/');
    expect(disallows).not.toContain('/dashboard/');
  });

  it('includes the repairs sitemap when isRepairsCatalogEnabled is true', async () => {
    const { default: robots } = await import('./robots');
    mockHost = 'ogabassey.usebaci.com';
    mockBlogEnabled = true;
    mockRepairsEnabled = true;
    mockBusinessType = 'electronics';

    const result = await robots();

    expect(result.sitemap).toEqual([
      'https://ogabassey.usebaci.com/sitemap/static.xml',
      'https://ogabassey.usebaci.com/sitemap/products.xml',
      'https://ogabassey.usebaci.com/sitemap/categories.xml',
      'https://ogabassey.usebaci.com/sitemap/brand-authority.xml',
      'https://ogabassey.usebaci.com/sitemap/commercial-support.xml',
      'https://ogabassey.usebaci.com/sitemap/repairs.xml',
      'https://ogabassey.usebaci.com/blog/sitemap.xml',
      'https://ogabassey.usebaci.com/blog/news-sitemap.xml',
    ]);
  });

  it('omits the repairs sitemap when business type is not eligible even if flag is true', async () => {
    const { default: robots } = await import('./robots');
    mockHost = 'ogabassey.usebaci.com';
    mockBlogEnabled = false;
    mockRepairsEnabled = true;
    mockBusinessType = 'fashion';

    const result = await robots();

    expect(result.sitemap).not.toContain(
      'https://ogabassey.usebaci.com/sitemap/repairs.xml'
    );
  });
});
