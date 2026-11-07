import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

let mockHost = 'localhost:3000';
let mockBlogEnabled = true;
let mockRepairsEnabled = false;
let mockBusinessType: string | null = 'electronics';

vi.mock('next/headers', () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((name: string) => {
        if (name === 'host') return mockHost;
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

vi.mock('@/lib/storefront-route-identifier', () => ({
  resolveRouteIdentifier: vi.fn(() => 'ogabassey'),
}));

import { getMerchantByIdentifier } from '@/lib/cached-data';
import { resolveRouteIdentifier } from '@/lib/storefront-route-identifier';

// ---- Tests ----

describe('robots()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHost = 'localhost:3000';
    mockBlogEnabled = true;
    mockRepairsEnabled = false;
    mockBusinessType = 'electronics';
    // Reset env
    delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  });

  it('returns robots config with sitemap URL', async () => {
    const { default: robots } = await import('./robots');

    const result = await robots();

    expect(result.sitemap).toBe('http://localhost:3000/sitemap.xml');
    expect(result.rules).toBeDefined();
    expect(Array.isArray(result.rules)).toBe(true);
  });

  it('uses http protocol for localhost', async () => {
    const { default: robots } = await import('./robots');
    mockHost = 'localhost:3000';

    const result = await robots();

    expect(result.sitemap).toBe('http://localhost:3000/sitemap.xml');
  });

  it('uses https protocol for non-localhost hosts', async () => {
    const { default: robots } = await import('./robots');
    mockHost = 'ogabassey.usebaci.com';

    const result = await robots();

    expect(result.sitemap).toEqual([
      'https://ogabassey.usebaci.com/sitemap/static.xml',
      'https://ogabassey.usebaci.com/sitemap/products.xml',
      'https://ogabassey.usebaci.com/sitemap/categories.xml',
      'https://ogabassey.usebaci.com/sitemap/brand-authority.xml',
      'https://ogabassey.usebaci.com/sitemap/commercial-support.xml',
      'https://ogabassey.usebaci.com/blog/sitemap.xml',
      'https://ogabassey.usebaci.com/blog/news-sitemap.xml',
    ]);
  });

  it('uses the root sitemap for the platform domain', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'usebaci.com';

    const result = await robots();

    expect(result.sitemap).toBe('https://usebaci.com/sitemap.xml');
  });

  it('includes platform disallows for platform domain', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'usebaci.com';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;

    expect(defaultRule.disallow).toContain('/dashboard/');
    expect(defaultRule.disallow).toContain('/onboarding/');
    expect(defaultRule.disallow).toContain('/auth/');
    expect(defaultRule.disallow).toContain('/api/');
    expect(defaultRule.disallow).not.toContain('/blog/category/');
  });

  it('includes platform disallows for www subdomain', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'www.usebaci.com';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;

    expect(defaultRule.disallow).toContain('/dashboard/');
    expect(defaultRule.disallow).toContain('/onboarding/');
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
    // Should NOT include platform paths
    expect(disallows).not.toContain('/dashboard/');
    expect(disallows).not.toContain('/onboarding/');
    expect(disallows).not.toContain('/auth/');
    // Should NOT disallow public storefront routes or crawlable query params
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
    expect(result.sitemap).toEqual([
      'https://ogabassey.usebaci.com/sitemap/static.xml',
      'https://ogabassey.usebaci.com/sitemap/products.xml',
      'https://ogabassey.usebaci.com/sitemap/categories.xml',
      'https://ogabassey.usebaci.com/sitemap/brand-authority.xml',
      'https://ogabassey.usebaci.com/sitemap/commercial-support.xml',
      'https://ogabassey.usebaci.com/blog/sitemap.xml',
      'https://ogabassey.usebaci.com/blog/news-sitemap.xml',
    ]);
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
    expect(result.sitemap).toEqual([
      'https://shop.ogabassey.com/sitemap/static.xml',
      'https://shop.ogabassey.com/sitemap/products.xml',
      'https://shop.ogabassey.com/sitemap/categories.xml',
      'https://shop.ogabassey.com/sitemap/brand-authority.xml',
      'https://shop.ogabassey.com/sitemap/commercial-support.xml',
      'https://shop.ogabassey.com/blog/sitemap.xml',
      'https://shop.ogabassey.com/blog/news-sitemap.xml',
    ]);
  });

  it('canonicalizes legacy blog subdomain robots to the root storefront host', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'blog.ogabassey.com';

    const result = await robots();

    expect(resolveRouteIdentifier).not.toHaveBeenCalled();
    expect(getMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(result.sitemap).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/news-sitemap.xml',
    ]);
  });

  it('canonicalizes legacy blog hosts case-insensitively', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'Blog.OgaBassey.com';

    const result = await robots();

    expect(resolveRouteIdentifier).not.toHaveBeenCalled();
    expect(getMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(result.sitemap).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/news-sitemap.xml',
    ]);
  });

  it('preserves ports when canonicalizing legacy blog hosts', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'blog.ogabassey.com:8443';

    const result = await robots();

    expect(resolveRouteIdentifier).not.toHaveBeenCalled();
    expect(getMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(result.sitemap).toEqual([
      'https://ogabassey.com:8443/sitemap/static.xml',
      'https://ogabassey.com:8443/sitemap/products.xml',
      'https://ogabassey.com:8443/sitemap/categories.xml',
      'https://ogabassey.com:8443/sitemap/brand-authority.xml',
      'https://ogabassey.com:8443/sitemap/commercial-support.xml',
      'https://ogabassey.com:8443/blog/sitemap.xml',
      'https://ogabassey.com:8443/blog/news-sitemap.xml',
    ]);
  });

  it('does not block public machine feed URLs on storefront domains', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'ogabassey.com';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;
    const disallows = defaultRule.disallow as string[];

    expect(disallows).not.toContain('/feeds/');
    expect(disallows).not.toContain('/feeds/google-merchant.xml');
  });

  it('treats localhost as platform domain', async () => {
    const { default: robots } = await import('./robots');
    mockHost = 'localhost:3000';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;

    expect(defaultRule.disallow).toContain('/dashboard/');
  });

  it('does not block Next.js assets for the platform domain', async () => {
    const { default: robots } = await import('./robots');
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    mockHost = 'usebaci.com';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;

    expect(defaultRule.disallow).not.toContain('/_next/');
  });

  it('includes AI bot user agents', async () => {
    const { default: robots } = await import('./robots');

    const result = await robots();
    const rules = result.rules as Array<{ userAgent: string }>;
    const agents = rules.map((r) => r.userAgent);

    expect(agents).toContain('*');
    expect(agents).toContain('GPTBot');
    expect(agents).toContain('ClaudeBot');
    expect(agents).toContain('Claude-User');
    expect(agents).toContain('Claude-SearchBot');
    expect(agents).toContain('PerplexityBot');
    expect(agents).toContain('Google-Extended');
  });

  it('all rules allow root path', async () => {
    const { default: robots } = await import('./robots');

    const result = await robots();
    const rules = result.rules as Array<{ allow: string }>;

    for (const rule of rules) {
      expect(rule.allow).toBe('/');
    }
  });

  it('defaults root domain to usebaci.com when env not set', async () => {
    const { default: robots } = await import('./robots');
    delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    mockHost = 'usebaci.com';

    const result = await robots();
    const defaultRule = Array.isArray(result.rules)
      ? result.rules[0]
      : result.rules;

    // Should be treated as platform domain
    expect(defaultRule.disallow).toContain('/dashboard/');
  });

  it('uses http for 127.0.0.1', async () => {
    const { default: robots } = await import('./robots');
    mockHost = '127.0.0.1:3000';

    const result = await robots();

    expect(result.sitemap).toBe('http://127.0.0.1:3000/sitemap.xml');
  });

  it('omits the blog sitemap for storefronts when blog_enabled is false', async () => {
    const { default: robots } = await import('./robots');
    mockHost = 'ogabassey.usebaci.com';
    mockBlogEnabled = false;

    const result = await robots();

    expect(result.sitemap).toEqual([
      'https://ogabassey.usebaci.com/sitemap/static.xml',
      'https://ogabassey.usebaci.com/sitemap/products.xml',
      'https://ogabassey.usebaci.com/sitemap/categories.xml',
      'https://ogabassey.usebaci.com/sitemap/brand-authority.xml',
      'https://ogabassey.usebaci.com/sitemap/commercial-support.xml',
    ]);
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
