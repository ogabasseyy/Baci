import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPublicSupabaseClient = vi.fn();
const mockHydrateAndSanitizeProducts = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));
vi.mock('@/lib/hydrate-public-products', () => ({
  hydrateAndSanitizePublicProducts: (...args: unknown[]) =>
    mockHydrateAndSanitizeProducts(...args),
}));
vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    createClient: () => mockGetPublicSupabaseClient(),
  },
}));

function makeQuery(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data, error });
  return query;
}

describe('getCachedBrandAuthorityProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHydrateAndSanitizeProducts.mockImplementation(
      async (_supabase: unknown, _merchantId: unknown, products: unknown) =>
        products
    );
  });

  it('hydrates public inventory before returning a bounded display selection', async () => {
    const query = makeQuery([
      {
        id: 'product-1',
        name: 'Samsung Galaxy',
        price: 100,
        stock: 1,
        category: 'Smartphones',
      },
    ]);
    mockGetPublicSupabaseClient.mockReturnValue({ from: () => query });
    const { brandAuthorityTaxonomy } = await import(
      './brand-authority-taxonomy'
    );
    const { getCachedBrandAuthorityProducts } = await import(
      './get-cached-brand-authority-products'
    );
    const entry = brandAuthorityTaxonomy.getEntry('smartphones', 'samsung');
    if (!entry) {
      throw new Error('Expected Samsung taxonomy entry');
    }

    await expect(
      getCachedBrandAuthorityProducts('merchant-1', 'smartphones', entry)
    ).resolves.toEqual([
      {
        id: 'product-1',
        name: 'Samsung Galaxy',
        price: 100,
        stock: 1,
        category: 'Smartphones',
      },
    ]);

    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.ilike).toHaveBeenCalledWith('brand', 'Samsung');
    expect(query.or).toHaveBeenCalledWith(
      'is_parent.eq.true,parent_product_id.is.null'
    );
    expect(mockHydrateAndSanitizeProducts).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      expect.any(Array)
    );
    expect(query.range).toHaveBeenCalledWith(0, 99);
    expect(query.order).toHaveBeenNthCalledWith(1, 'updated_at', {
      ascending: false,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
  });

  it('slices to BRAND_AUTHORITY_PRODUCT_LIMIT (48) by default and returns full list when limit is null', async () => {
    const products = Array.from({ length: 60 }, (_, index) => ({
      id: `product-${index}`,
      name: `Samsung Galaxy ${index}`,
      price: 100,
      stock: 1,
      category: 'Smartphones',
    }));
    const query = makeQuery(products);
    mockGetPublicSupabaseClient.mockReturnValue({ from: () => query });
    const { brandAuthorityTaxonomy } = await import(
      './brand-authority-taxonomy'
    );
    const { getCachedBrandAuthorityProducts } = await import(
      './get-cached-brand-authority-products'
    );
    const entry = brandAuthorityTaxonomy.getEntry('smartphones', 'samsung');
    if (!entry) throw new Error('Expected Samsung taxonomy entry');

    // Default limit should be 48
    const defaultLimited = await getCachedBrandAuthorityProducts(
      'merchant-1',
      'smartphones',
      entry
    );
    expect(defaultLimited).toHaveLength(48);

    // Limit null should return all 60 products
    const unlimited = await getCachedBrandAuthorityProducts(
      'merchant-1',
      'smartphones',
      entry,
      { limit: null }
    );
    expect(unlimited).toHaveLength(60);
  });

  it('uses serialized public availability instead of stale product stock', async () => {
    const product = {
      id: 'product-1',
      name: 'Samsung Galaxy',
      price: 100,
      stock: 4,
      manage_stock: true,
      category: 'Smartphones',
    };
    const query = makeQuery([product]);
    mockGetPublicSupabaseClient.mockReturnValue({ from: () => query });
    mockHydrateAndSanitizeProducts.mockResolvedValue([
      { ...product, stock: 0, stock_quantity: 0, manage_stock: true },
    ]);
    const { brandAuthorityTaxonomy } = await import(
      './brand-authority-taxonomy'
    );
    const { getCachedBrandAuthorityProducts } = await import(
      './get-cached-brand-authority-products'
    );
    const entry = brandAuthorityTaxonomy.getEntry('smartphones', 'samsung');
    if (!entry) throw new Error('Expected Samsung taxonomy entry');

    await expect(
      getCachedBrandAuthorityProducts('merchant-1', 'smartphones', entry)
    ).resolves.toEqual([]);
  });

  it('keeps serialized-then-unlimited products that hydrate as purchasable', async () => {
    const product = {
      id: 'product-1',
      name: 'Samsung Galaxy',
      price: 100,
      stock: 0,
      manage_stock: true,
      category: 'Smartphones',
    };
    const query = makeQuery([product]);
    mockGetPublicSupabaseClient.mockReturnValue({ from: () => query });
    mockHydrateAndSanitizeProducts.mockResolvedValue([
      { ...product, stock: 9999, manage_stock: false },
    ]);
    const { brandAuthorityTaxonomy } = await import(
      './brand-authority-taxonomy'
    );
    const { getCachedBrandAuthorityProducts } = await import(
      './get-cached-brand-authority-products'
    );
    const entry = brandAuthorityTaxonomy.getEntry('smartphones', 'samsung');
    if (!entry) throw new Error('Expected Samsung taxonomy entry');

    await expect(
      getCachedBrandAuthorityProducts('merchant-1', 'smartphones', entry)
    ).resolves.toEqual([{ ...product, stock: 9999, manage_stock: false }]);
  });

  it('propagates query failures so callers do not publish incomplete hubs', async () => {
    const query = makeQuery(null, new Error('timeout'));
    mockGetPublicSupabaseClient.mockReturnValue({ from: () => query });
    const { brandAuthorityTaxonomy } = await import(
      './brand-authority-taxonomy'
    );
    const { getCachedBrandAuthorityProducts } = await import(
      './get-cached-brand-authority-products'
    );
    const entry = brandAuthorityTaxonomy.getEntry('smartphones', 'samsung');
    if (!entry) {
      throw new Error('Expected Samsung taxonomy entry');
    }

    await expect(
      getCachedBrandAuthorityProducts('merchant-1', 'smartphones', entry)
    ).rejects.toThrow('timeout');
  });
});
