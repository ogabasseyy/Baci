import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

let mockHeaders = new Map<string, string>();
const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCategoryPageData = vi.fn();
const mockGetCachedCategoryProductCounts = vi.fn();
const mockGetBrandAuthorityCategory = vi.fn();
const mockGetCachedBrandAuthorityInventory = vi.fn();
const mockBuildCommercialSupportDiscoveryLinks = vi.fn();
const mockQueryResults = new Map<
  string,
  { data: unknown; error: Error | null }
>();
const mockSelectCalls: string[] = [];
let sitemapData: typeof import('./sitemap-data');

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
}));
vi.mock('@/lib/cached-category-product-counts', () => ({
  getCachedCategoryProductCounts: (...args: unknown[]) =>
    mockGetCachedCategoryProductCounts(...args),
}));
vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    getCategory: (...args: unknown[]) => mockGetBrandAuthorityCategory(...args),
  },
}));
vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  () => ({
    getCachedBrandAuthorityInventory: (...args: unknown[]) =>
      mockGetCachedBrandAuthorityInventory(...args),
  })
);

vi.mock('@/lib/storefront-compare/build-compare-discovery-links', () => ({
  buildCommercialSupportDiscoveryLinks: (...args: unknown[]) =>
    mockBuildCommercialSupportDiscoveryLinks(...args),
}));

vi.mock('@/lib/seo-utils', () => ({
  generateSlug: vi.fn((str: string) => str.toLowerCase().replace(/\s+/g, '-')),
  getValidatedProductUrl: vi.fn(
    (
      product: {
        id: string;
        slug?: string | null;
        category_slug?: string | null;
        categories?: { slug?: string | null } | null;
      },
      baseUrl: string
    ) => {
      const slug = product.slug || product.id;
      const categorySlug = product.categories?.slug || product.category_slug;
      const productPath = categorySlug
        ? `/${categorySlug}/${slug}`
        : `/products/${slug}`;
      return `${new URL(baseUrl).origin}${productPath}`;
    }
  ),
}));

function createEq(table: string) {
  return vi.fn((...args: unknown[]) => {
    const [key, value] = args as [string, string];
    const response = mockQueryResults.get(table);
    const isTerminalQuery =
      (table === 'products' && key === 'status' && value === 'active') ||
      (table === 'categories' &&
        key === 'merchant_id' &&
        value === 'merchant-1');

    if (isTerminalQuery) {
      if (table === 'products') {
        const rows = Array.isArray(response?.data)
          ? (response?.data as unknown[])
          : [];

        return {
          data: rows,
          error: response?.error ?? null,
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              range: (from: number, to: number) => ({
                data: rows.slice(from, to + 1),
                error: response?.error ?? null,
              }),
            })),
            range: (from: number, to: number) => ({
              data: rows.slice(from, to + 1),
              error: response?.error ?? null,
            }),
          })),
          range: (from: number, to: number) => ({
            data: rows.slice(from, to + 1),
            error: response?.error ?? null,
          }),
        };
      }

      return {
        data: response?.data ?? [],
        error: response?.error ?? null,
      };
    }

    return { eq: createEq(table) };
  });
}

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({
    from: (table: string) => ({
      select: (columns?: string) => {
        if (columns) {
          mockSelectCalls.push(columns);
        }

        return {
          eq: createEq(table),
        };
      },
    }),
  })),
}));

function setCustomDomainHeader(domain: string) {
  mockHeaders = new Map<string, string>([['x-custom-domain', domain]]);
}

function setMerchantDomainHeader(domain: string) {
  mockHeaders = new Map<string, string>([['x-merchant-domain', domain]]);
}

function setHostHeader(host: string) {
  mockHeaders = new Map<string, string>([['host', host]]);
}

function mockProductsQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('products', { data, error });
}

function mockCategoriesQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('categories', { data, error });
}

describe('sitemap-data', () => {
  beforeAll(async () => {
    sitemapData = await import('./sitemap-data');
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders = new Map();
    mockQueryResults.clear();
    mockSelectCalls.length = 0;
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      feature_settings: { blog_enabled: true },
    });
    mockGetCachedCategoryPageData.mockReset();
    mockGetCachedCategoryPageData.mockResolvedValue(null);
    mockGetCachedCategoryProductCounts.mockReset();
    mockGetBrandAuthorityCategory.mockReset();
    mockGetBrandAuthorityCategory.mockResolvedValue(null);
    mockGetCachedBrandAuthorityInventory.mockReset();
    mockGetCachedBrandAuthorityInventory.mockResolvedValue({
      latestUpdatedAt: null,
      productCount: 0,
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReset();
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([]);
  });

  it('resolves storefront context from a custom domain header', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      feature_settings: { blog_enabled: true },
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('prefers an explicit route identifier override when resolving context', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'ogabassey'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey');
    expect(context?.merchant.slug).toBe('ogabassey');
  });

  it('prefers the custom domain header over route params for named sitemap rewrites', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      feature_settings: { blog_enabled: true },
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'sitemap'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('treats x-merchant-domain as a storefront context header for named sitemap rewrites', async () => {
    setMerchantDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'sitemap'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('uses the custom-domain host when direct named sitemap routing exposes sitemap as the slug param', async () => {
    setHostHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'sitemap'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('falls back to the explicit slug when the request host is not a merchant domain', async () => {
    setHostHeader('preview.usebaci.com');
    mockGetMerchantByIdentifier
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
      });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'ogabassey'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(1, 'preview');
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(2, 'ogabassey');
    expect(context?.merchant.slug).toBe('ogabassey');
  });

  it('allows a real merchant slug named sitemap without header context', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-sitemap',
      slug: 'sitemap',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'sitemap'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('sitemap');
    expect(context?.merchant.slug).toBe('sitemap');
  });

  it('returns static sitemap entries for the storefront root and faq', () => {
    const { getStaticSitemapEntries } = sitemapData;
    const entries = getStaticSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
        updated_at: '2026-06-01T00:00:00Z',
      },
      storeUrl: 'https://ogabassey.com',
    } as unknown as Parameters<typeof getStaticSitemapEntries>[0]);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com',
        priority: 1,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/faq',
        priority: 0.5,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
    ]);
  });

  it('omits lastmod from static entries when the merchant has no updated_at', () => {
    const { getStaticSitemapEntries } = sitemapData;
    const entries = getStaticSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
      },
      storeUrl: 'https://ogabassey.com',
    } as unknown as Parameters<typeof getStaticSitemapEntries>[0]);

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.lastModified).toBeUndefined();
    }
  });

  it('adds publishable trust policy URLs to the static sitemap entries', async () => {
    const { getNamedSitemapEntries } = sitemapData;
    const context = {
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
        updated_at: '2026-06-01T00:00:00Z',
        trust_profile: {
          return_policy: { summary: 'Returns accepted within 7 days.' },
          shipping_policy: { summary: 'Ships nationwide.' },
          warranty_policy: { summary: 'One-year warranty included.' },
        },
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
          }),
        }),
      },
    } as unknown as StorefrontSitemapContext;

    const staticEntries = await getNamedSitemapEntries(context, 'static');

    expect(staticEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://ogabassey.com/returns',
          lastModified: new Date('2026-06-01T00:00:00Z'),
        }),
        expect.objectContaining({ url: 'https://ogabassey.com/shipping' }),
        expect.objectContaining({ url: 'https://ogabassey.com/warranty' }),
      ])
    );
  });

  it('returns product sitemap entries with category paths and images', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });
    mockProductsQuery([
      {
        id: 'p1',
        name: 'iPhone 15',
        slug: 'iphone-15',
        category: 'Smartphones',
        images: ['https://img.example.com/iphone.jpg'],
        updated_at: '2026-01-15T00:00:00Z',
        category_id: 'cat-1',
        category_slug: null,
        categories: { slug: 'smartphones' },
      },
    ]);
    const { resolveStorefrontSitemapContext, getProductSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getProductSitemapEntries(context);

    expect(entries[0]).toMatchObject({
      url: 'https://ogabassey.com/smartphones/iphone-15',
      images: ['https://img.example.com/iphone.jpg'],
    });
  });

  it('paginates product sitemap queries beyond the Supabase 1000 row default', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });

    mockProductsQuery(
      Array.from({ length: 1002 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `Product ${index + 1}`,
        slug: `product-${index + 1}`,
        category: 'Smartphones',
        images: [],
        updated_at: '2026-01-15T00:00:00Z',
        category_id: 'cat-1',
        category_slug: null,
        categories: { slug: 'smartphones' },
      }))
    );

    const { resolveStorefrontSitemapContext, getProductSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getProductSitemapEntries(context);

    expect(entries).toHaveLength(1002);
    expect(entries[1001]?.url).toBe(
      'https://ogabassey.com/smartphones/product-1002'
    );
  });

  it('falls back to /products path when category slug is missing', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });
    mockProductsQuery([
      {
        id: 'p2',
        name: 'MacBook Pro M4 Max',
        slug: 'macbook-pro-m4-max-36gb-1tb-16-inch',
        category: 'Laptops',
        images: [],
        updated_at: '2026-01-16T00:00:00Z',
        category_id: null,
        category_slug: null,
        categories: null,
      },
    ]);
    const { resolveStorefrontSitemapContext, getProductSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getProductSitemapEntries(context);

    expect(entries[0]).toMatchObject({
      url: 'https://ogabassey.com/products/macbook-pro-m4-max-36gb-1tb-16-inch',
    });
  });

  it('does not select missing products.category_slug directly', async () => {
    mockProductsQuery([]);
    const { getProductSitemapEntries } = sitemapData;

    await getProductSitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: (columns: string) => {
            mockSelectCalls.push(columns);
            return { eq: createEq(table) };
          },
        }),
      },
    } as unknown as Parameters<typeof getProductSitemapEntries>[0]);

    expect(mockSelectCalls.join('\n')).not.toMatch(/\bcategory_slug\b/);
    expect(mockSelectCalls.join('\n')).toContain(
      'product_categories:product_categories(category_id, categories(slug, is_active))'
    );
  });

  it('includes blog child sitemaps in the sitemap index when the blog is enabled', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      feature_settings: { blog_enabled: true },
    });
    const { resolveStorefrontSitemapContext, getSitemapIndexLinks } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const links = await getSitemapIndexLinks(context);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/news-sitemap.xml',
    ]);
  });

  it('includes the repairs child sitemap when the repairs catalogue is enabled', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      business_type: 'electronics',
      // blog_enabled comes straight off the snapshot's feature_settings now;
      // pinning it false keeps this case about the repairs link alone.
      feature_settings: { repairs_catalog_enabled: true, blog_enabled: false },
    });

    const { resolveStorefrontSitemapContext, getSitemapIndexLinks } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const links = await getSitemapIndexLinks(context);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
      'https://ogabassey.com/sitemap/repairs.xml',
    ]);
  });

  it('omits the repairs child sitemap when the repairs catalogue is disabled', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      business_type: 'electronics',
      feature_settings: { repairs_catalog_enabled: false, blog_enabled: false },
    });

    const { resolveStorefrontSitemapContext, getSitemapIndexLinks } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const links = await getSitemapIndexLinks(context);

    expect(links).not.toContain('https://ogabassey.com/sitemap/repairs.xml');
  });

  it('builds repairs sitemap entries for the index and active device pages', async () => {
    const { getRepairsSitemapEntries } = sitemapData;

    const entries = await getRepairsSitemapEntries({
      merchant: {
        id: 'merchant-1',
        is_published: true,
        slug: 'ogabassey',
        business_type: 'electronics',
        feature_settings: { repairs_catalog_enabled: true },
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  data: [
                    { slug: 'apple-iphone-13' },
                    { slug: 'samsung-galaxy-s23' },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({ url: 'https://ogabassey.com/repairs' }),
      expect.objectContaining({
        url: 'https://ogabassey.com/repairs/apple-iphone-13',
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/repairs/samsung-galaxy-s23',
      }),
    ]);
    expect(entries[0]?.lastModified).toBeUndefined();
  });

  it('returns no direct repairs sitemap entries when the catalogue is disabled', async () => {
    const { getRepairsSitemapEntries } = sitemapData;
    const from = vi.fn();

    await expect(
      getRepairsSitemapEntries({
        merchant: {
          id: 'merchant-1',
          is_published: true,
          slug: 'ogabassey',
          business_type: 'electronics',
          feature_settings: { repairs_catalog_enabled: false },
        },
        storeUrl: 'https://ogabassey.com',
        supabase: { from },
      } as unknown as StorefrontSitemapContext)
    ).resolves.toEqual([]);

    expect(from).not.toHaveBeenCalled();
  });

  it('throws when the repairs device query errors so the route can 503', async () => {
    const { getRepairsSitemapEntries } = sitemapData;

    await expect(
      getRepairsSitemapEntries({
        merchant: {
          id: 'merchant-1',
          is_published: true,
          slug: 'ogabassey',
          business_type: 'electronics',
          feature_settings: { repairs_catalog_enabled: true },
        },
        storeUrl: 'https://ogabassey.com',
        supabase: {
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    data: null,
                    error: new Error('rls denied'),
                  }),
                }),
              }),
            }),
          }),
        },
      } as unknown as StorefrontSitemapContext)
    ).rejects.toThrow('rls denied');
  });

  it('omits blog child sitemaps from the sitemap index when blog_enabled is false', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      feature_settings: { blog_enabled: false },
    });

    const { resolveStorefrontSitemapContext, getSitemapIndexLinks } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const links = await getSitemapIndexLinks(context);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
    ]);
  });

  it('keeps the core sitemap index links when the snapshot has no blog flag', () => {
    const { getSitemapIndexLinks } = sitemapData;

    const links = getSitemapIndexLinks({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
    ]);
  });

  it('serializes sitemap XML responses with image namespace when needed', async () => {
    const { createSitemapResponse } = sitemapData;
    const response = createSitemapResponse([
      {
        url: 'https://ogabassey.com/smartphones/iphone-15',
        lastModified: new Date('2026-01-15T00:00:00Z'),
        changeFrequency: 'weekly',
        priority: 0.8,
        images: ['https://img.example.com/iphone.jpg'],
      },
    ]);
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(body).toContain('<urlset');
    expect(body).toContain('xmlns:image=');
    expect(body).toContain(
      '<image:loc>https://img.example.com/iphone.jpg</image:loc>'
    );
  });

  it('publishes eligible compare pages through the public sitemap surfaces', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockCategoriesQuery([
      { slug: 'smartphones', updated_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
        {
          id: 'samsung-galaxy-z-trifold',
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          brand: 'Samsung',
          price: 480000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Snapdragon 8 Elite',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
      ],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        label: 'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold',
      },
    ]);
    const { resolveStorefrontSitemapContext, getNamedSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const namedEntries = await getNamedSitemapEntries(
      context,
      'commercial-support'
    );

    expect(
      namedEntries.some((entry) =>
        entry.url.includes(
          '/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
        )
      )
    ).toBe(true);
  });

  it('passes the active related category to commercial support discovery links', async () => {
    mockCategoriesQuery([
      { slug: 'smartphones', updated_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'phones',
          product_categories: [
            { categories: { slug: 'smartphones', name: 'Smartphones' } },
          ],
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      ({
        products,
      }: {
        products: Array<{ category_slug: string; slug: string }>;
      }) =>
        products.map((product) => ({
          href: `https://ogabassey.com/${product.category_slug}/compare/${product.slug}-vs-anchor`,
          label: `${product.slug} vs Anchor`,
        }))
    );
    const { getCommercialSupportSitemapEntries } = sitemapData;

    const entries = await getCommercialSupportSitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-anchor',
      }),
    ]);
  });

  it('keeps child-category products out of parent-category compare sitemap URLs', async () => {
    mockCategoriesQuery([
      { slug: 'electronics', updated_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Electronics',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          categories: { slug: 'smartphones', name: 'Smartphones' },
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      ({
        products,
      }: {
        products: Array<{ category_slug: string; slug: string }>;
      }) =>
        products.map((product) => ({
          href: `https://ogabassey.com/${product.category_slug}/compare/${product.slug}-vs-anchor`,
          label: `${product.slug} vs Anchor`,
        }))
    );
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-anchor',
        }),
      ])
    );
    expect(entries.map((entry) => entry.url)).not.toContain(
      'https://ogabassey.com/electronics/compare/iphone-17-pro-max-vs-anchor'
    );
  });

  it('falls back to the active category for commercial support products without relation slugs', async () => {
    mockCategoriesQuery([
      { slug: 'smartphones', updated_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'phones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-galaxy-s25',
        label: 'iPhone 17 Pro Max vs Galaxy S25',
      },
    ]);
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-galaxy-s25',
      }),
    ]);
  });

  it('loads commercial-support sitemap categories in bounded concurrent batches', async () => {
    const { SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY } = sitemapData;
    mockCategoriesQuery(
      Array.from(
        { length: SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY + 1 },
        (_, index) => ({
          slug: `category-${index}`,
          updated_at: '2026-01-01T00:00:00Z',
        })
      )
    );
    let activeLoads = 0;
    let maxActiveLoads = 0;
    mockGetCachedCategoryPageData.mockImplementation(async () => {
      activeLoads += 1;
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
      await Promise.resolve();
      activeLoads -= 1;

      return {
        isCollection: false,
        fallbackName: 'Category',
        products: [
          {
            id: 'iphone-17-pro-max',
            slug: 'iphone-17-pro-max',
            name: 'iPhone 17 Pro Max',
            brand: 'Apple',
            price: 495000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
        ],
      };
    });
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      ({ categorySlug }: { categorySlug: string }) => [
        {
          href: `https://ogabassey.com/${categorySlug}/compare/a-vs-b`,
          label: 'A vs B',
        },
      ]
    );
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toHaveLength(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY + 1
    );
    expect(maxActiveLoads).toBe(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
  });

  it('caps commercial-support sitemap entries and stops before later batches', async () => {
    const { SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY } = sitemapData;
    mockCategoriesQuery(
      Array.from(
        { length: SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY + 1 },
        (_, index) => ({
          slug: `category-${index}`,
          updated_at: '2026-01-01T00:00:00Z',
        })
      )
    );
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
      SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([]);
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      ({ categorySlug }: { categorySlug: string }) =>
        categorySlug === 'category-0'
          ? Array.from(
              { length: SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS + 5 },
              (_, index) => ({
                href: `https://ogabassey.com/category-0/compare/a-${index}-vs-b-${index}`,
                label: `A ${index} vs B ${index}`,
              })
            )
          : []
    );
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toHaveLength(SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS);
    expect(entries.at(-1)?.url).toBe(
      `https://ogabassey.com/category-0/compare/a-${SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS - 1}-vs-b-${SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS - 1}`
    );
    expect(mockGetCachedCategoryPageData).toHaveBeenCalledTimes(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
    expect(mockBuildCommercialSupportDiscoveryLinks).toHaveBeenCalledTimes(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
  });

  it('deduplicates commercial-support URLs across category batches', async () => {
    const { SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY } = sitemapData;
    mockCategoriesQuery(
      Array.from(
        { length: SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY + 1 },
        (_, index) => ({
          slug: `category-${index}`,
          updated_at: '2026-01-01T00:00:00Z',
        })
      )
    );
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-b',
        label: 'A vs B',
      },
    ]);
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-b',
      }),
    ]);
  });

  it('resolves slug from request host when headersList is empty and override is undefined', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'hhjjk',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;
    const emptyHeaders = new Headers();
    const req = new Request('https://hhjjk.usebaci.com/sitemap.xml');

    const context = await resolveStorefrontSitemapContext(
      emptyHeaders,
      undefined,
      req
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('hhjjk');
    expect(context?.merchant.slug).toBe('hhjjk');
  });

  it('resolves by domain from request x-custom-domain header even with a garbage slug override', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;
    const emptyHeaders = new Headers();
    const req = new Request('https://ogabassey.com/sitemap.xml', {
      headers: {
        'x-custom-domain': 'ogabassey.com',
      },
    });

    const context = await resolveStorefrontSitemapContext(
      emptyHeaders,
      'garbage-slug',
      req
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('tries non-www host segment before www host segment for a custom domain host', async () => {
    mockGetMerchantByIdentifier.mockImplementation((id) => {
      if (id === 'ogabassey.com') {
        return Promise.resolve({
          id: 'merchant-1',
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com',
        });
      }
      return Promise.resolve(null);
    });
    const { resolveStorefrontSitemapContext } = sitemapData;
    const emptyHeaders = new Headers();
    const req = new Request('https://www.ogabassey.com/sitemap.xml');

    const context = await resolveStorefrontSitemapContext(
      emptyHeaders,
      undefined,
      req
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      1,
      'ogabassey.com'
    );
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('skips invalid candidates without throwing and logs a warning on not-found all-miss', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      return;
    });

    try {
      mockGetMerchantByIdentifier.mockResolvedValue(null);
      const { resolveStorefrontSitemapContext } = sitemapData;
      const emptyHeaders = new Headers();
      const req = new Request('https://invalid.usebaci.com/sitemap.xml', {
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'session=secret',
          'x-custom-domain': 'invalid.example.com',
        },
      });

      const context = await resolveStorefrontSitemapContext(
        emptyHeaders,
        'cart', // reserved path, invalid candidate
        req
      );

      expect(context).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      const [, payload] = warnSpy.mock.calls.at(-1) ?? [];
      expect(payload).toMatchObject({
        safeHeaders: { 'x-custom-domain': 'invalid.example.com' },
      });
      expect(JSON.stringify(payload)).not.toContain('secret-token');
      expect(JSON.stringify(payload)).not.toContain('session=secret');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('serializes a sitemap index with sitemap loc entries', () => {
    const { serializeSitemapIndex } = sitemapData;
    const xml = serializeSitemapIndex([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
    ]);

    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml).toContain(
      '<sitemap><loc>https://ogabassey.com/sitemap/static.xml</loc></sitemap>'
    );
    expect(xml).toContain(
      '<sitemap><loc>https://ogabassey.com/sitemap/products.xml</loc></sitemap>'
    );
    expect(xml).not.toContain('<urlset');
  });

  it('creates a cacheable XML response for the sitemap index', async () => {
    const { createSitemapIndexResponse } = sitemapData;
    const response = createSitemapIndexResponse([
      'https://ogabassey.com/sitemap/static.xml',
    ]);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );
    expect(body).toContain('<sitemapindex');
  });

  it('omits lastmod from category entries when updated_at is missing', async () => {
    mockCategoriesQuery([
      {
        id: 'category-smartphones',
        slug: 'smartphones',
        updated_at: null,
        is_active: true,
        parent_id: null,
      },
    ]);
    mockGetCachedCategoryProductCounts.mockResolvedValueOnce({
      'category-smartphones': 1,
    });
    const { getCategorySitemapEntries } = sitemapData;

    const entries = await getCategorySitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({ url: 'https://ogabassey.com/smartphones' }),
    ]);
    expect(entries[0]?.lastModified).toBeUndefined();
  });

  it('lists only inventory-qualified curated brand authority hubs', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue({
      id: 'category-1',
      name: 'Smartphones',
    });
    mockGetCachedBrandAuthorityInventory.mockImplementation(
      async (
        _merchantId: string,
        _categorySlug: string,
        entry: { brandKey: string }
      ) => ({
        latestUpdatedAt:
          entry.brandKey === 'samsung' ? '2026-07-14T00:00:00Z' : null,
        productCount: { google: 5, samsung: 5, tecno: 4 }[entry.brandKey] ?? 0,
      })
    );
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://ogabassey.com/smartphones/brands/samsung',
      'https://ogabassey.com/smartphones/brands/google',
    ]);
    expect(entries[0]?.lastModified).toEqual(new Date('2026-07-14T00:00:00Z'));
    expect(entries[1]?.lastModified).toBeUndefined();
    expect(mockGetCachedBrandAuthorityInventory).toHaveBeenCalledTimes(7);
  });

  it('keeps successful authority hubs when a single brand query fails', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue({
      id: 'category-1',
      name: 'Smartphones',
    });
    mockGetCachedBrandAuthorityInventory.mockImplementation(
      async (
        _merchantId: string,
        _categorySlug: string,
        entry: { brandKey: string }
      ) => {
        if (entry.brandKey !== 'samsung') throw new Error('timeout');
        return { latestUpdatedAt: '2026-07-14T00:00:00Z', productCount: 5 };
      }
    );
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/brands/samsung',
      }),
    ]);
  });

  it('omits authority hubs when the category cannot render publicly', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue(null);
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    await expect(
      getBrandAuthoritySitemapEntries({
        merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
        storeUrl: 'https://ogabassey.com',
        supabase: {},
      } as unknown as StorefrontSitemapContext)
    ).resolves.toEqual([]);
    expect(mockGetCachedBrandAuthorityInventory).not.toHaveBeenCalled();
  });

  it('omits lastmod from commercial-support entries when the category has no timestamp', async () => {
    mockCategoriesQuery([{ slug: 'smartphones', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-b',
        label: 'A vs B',
      },
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-c',
        label: 'A vs C',
      },
    ]);
    const { getCommercialSupportSitemapEntries } = sitemapData;

    const entries = await getCommercialSupportSitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-b',
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-c',
      }),
    ]);
    expect(entries[0]?.lastModified).toBeUndefined();
  });

  it('creates sitemap unavailable response with 503, no-store, and retry-after', () => {
    const { createSitemapUnavailableResponse } = sitemapData;
    const response = createSitemapUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('300');
  });

  it('creates sitemap not-found response with 404 and no retry header', () => {
    const { createSitemapNotFoundResponse } = sitemapData;
    const response = createSitemapNotFoundResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('marks transient storefront sitemap lookup failures as unavailable', async () => {
    mockGetMerchantByIdentifier.mockRejectedValueOnce(
      new Error('Database timeout')
    );
    const { resolveStorefrontSitemapContextResult } = sitemapData;

    const result = await resolveStorefrontSitemapContextResult(
      mockHeaders as unknown as Headers,
      'test-store',
      new Request('https://test-store.usebaci.com/sitemap/static.xml')
    );

    expect(result.status).toBe('unavailable');
  });

  it('distinguishes missing storefront sitemaps from transient lookup failures', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce(null);
    const { resolveStorefrontSitemapContextResult } = sitemapData;

    const result = await resolveStorefrontSitemapContextResult(
      mockHeaders as unknown as Headers,
      'test-store',
      new Request('https://test-store.usebaci.com/sitemap/static.xml')
    );

    expect(result.status).toBe('not-found');
  });
});
