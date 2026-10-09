import { jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';

const mockWithSupabaseRetry: jest.Mock = jest.fn();
const mockGetProductSlugFallbackCandidates = jest.fn();
const mockRemoveProductSlugFromProductsCache = jest.fn((cached, slug) => ({
  cached,
  slug,
}));
const mockFrom: jest.Mock = jest.fn();
const mockRpc: jest.Mock = jest.fn();

function mockVariantRpcQuery(result: unknown) {
  const query = {
    order: jest.fn(),
    range: jest.fn(async () => {
      const resolved = (await result) as {
        data?: unknown;
        error?: unknown;
      };
      return {
        ...resolved,
        count: resolved.error
          ? null
          : Array.isArray(resolved.data)
            ? resolved.data.length
            : 0,
      };
    }),
  };
  query.order.mockReturnValue(query);
  return query;
}

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>, options?: unknown) =>
    mockWithSupabaseRetry(operation, options),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: 'merchant-1',
    MERCHANT_SLUG: 'ogabassey',
  },
}));

jest.mock('@/lib/product-query-cache', () => ({
  removeProductSlugFromProductsCache: (cached: unknown, slug: string) =>
    mockRemoveProductSlugFromProductsCache(cached, slug),
}));

jest.mock('@/lib/product-slug-fallback', () => ({
  getProductSlugFallbackCandidates: (slug: string) =>
    mockGetProductSlugFallbackCandidates(slug),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => {
      const result = mockRpc(...args);
      return args[0] === 'get_storefront_product_variants'
        ? mockVariantRpcQuery(result)
        : result;
    },
  },
}));

const {
  fetchAvailableBrands,
  PRODUCT_DETAIL_SELECT,
  PRODUCT_QUERY_VERSION,
  PRODUCT_SELECT,
  fetchProductRow,
  fetchProductsPage,
  isUuid,
  resolveAndEvictProduct,
  resolveProductRow,
  transformProduct,
} = require('./product-utils') as typeof import('./product-utils');

interface QueryResult {
  data?: unknown;
  error?: Error | null;
  count?: number | null;
}

interface MockQueryChain {
  data: unknown;
  error: Error | null;
  count: number | null;
  select: jest.Mock;
  eq: jest.Mock;
  or: jest.Mock;
  in: jest.Mock;
  ilike: jest.Mock;
  textSearch: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  order: jest.Mock;
  range: jest.Mock;
  maybeSingle: jest.Mock;
}

function createQueryChain(result: QueryResult): MockQueryChain {
  const chain = {} as MockQueryChain;
  chain.data = result.data ?? null;
  chain.error = result.error ?? null;
  chain.count = result.count ?? null;
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.or = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.ilike = jest.fn(() => chain);
  chain.textSearch = jest.fn(() => chain);
  chain.gte = jest.fn(() => chain);
  chain.lte = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => result);

  return chain;
}

const validProductRow = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'iPhone 13 Pro',
  slug: 'iphone-13-pro',
  description: 'Flagship phone',
  price: 552000,
  compare_at_price: 600000,
  images: ['https://cdn.example.com/iphone-13-pro.jpg'],
  brand: 'Apple',
  color: 'Blue',
  condition: 'New',
  average_rating: 4.6,
  review_count: 18,
  manage_stock: true,
  stock: 4,
  stock_quantity: 4,
  status: 'active',
  specifications: { ram: '6GB' },
  has_variants: true,
  variant_model: 'legacy',
  available_conditions: ['new'],
  colors: ['Blue'],
  color_images: { Blue: ['https://cdn.example.com/iphone-13-pro-blue.jpg'] },
  has_condition_offers: true,
  offers: [
    {
      id: 'offer-used',
      condition: 'used',
      price: 510000,
      compare_at_price: 540000,
      stock_quantity: 2,
      images: ['https://cdn.example.com/iphone-13-pro-used.jpg'],
      condition_notes: 'Excellent condition',
      grade: 'A',
    },
  ],
  variants: [
    {
      id: 'variant-128gb',
      product_id: '123e4567-e89b-12d3-a456-426614174000',
      merchant_id: 'merchant-1',
      sku: 'IPHONE-13-PRO-128',
      price_override: 552000,
      primary_image: 'https://cdn.example.com/iphone-13-pro-128.jpg',
      images: ['https://cdn.example.com/iphone-13-pro-128.jpg'],
      stock_quantity: 4,
      attributes: { storage: '128GB' },
    },
  ],
  variant_attributes: [{ param: 'Storage', options: ['128GB', '256GB'] }],
  categories: [{ id: 'cat-1', name: 'Phones', slug: 'phones' }],
};

describe('product-utils', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockWithSupabaseRetry.mockImplementation((...args: unknown[]) => {
      const operation = args[0] as () => Promise<unknown> | unknown;
      return operation();
    });
    mockGetProductSlugFallbackCandidates.mockReturnValue([]);
    mockRpc.mockReset();
    mockRpc.mockImplementation((...args: unknown[]) => {
      const fn = args[0] as string;
      if (fn === 'get_storefront_product_variants') {
        return Promise.resolve({ data: [], error: null });
      }

      return Promise.resolve({ data: null, error: null });
    });
  });

  it('fetchProductRow scopes product lookups by merchant, status, and slug', async () => {
    const query = createQueryChain({ data: validProductRow, error: null });
    mockFrom.mockReturnValue(query);

    const result = await fetchProductRow(
      'merchant-1',
      'iphone-13-pro',
      'Product'
    );

    expect(result).toEqual({ data: validProductRow, error: null });
    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(query.select).toHaveBeenCalledWith(PRODUCT_DETAIL_SELECT);
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.eq).toHaveBeenCalledWith('slug', 'iphone-13-pro');
  });

  it('recognizes standard UUIDs without matching shortened UUID-like values', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUuid('123e4567-e89b-12d3-426614174000')).toBe(false);
  });

  it('resolveProductRow falls back to legacy slug candidates', async () => {
    const exactQuery = createQueryChain({ data: null, error: null });
    const fallbackQuery = createQueryChain({
      data: validProductRow,
      error: null,
    });
    mockFrom.mockReturnValueOnce(exactQuery).mockReturnValueOnce(fallbackQuery);
    mockGetProductSlugFallbackCandidates.mockReturnValue(['iphone-13-pro']);
    mockRpc.mockImplementationOnce(async () => ({
      data: validProductRow.variants,
      error: null,
    }));

    const result = await resolveProductRow(
      'merchant-1',
      'iphone-13-pro-128gb-premium-used'
    );

    expect(result).toEqual(validProductRow);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('resolveProductRow hydrates a variant product through exactly one storefront rpc', async () => {
    const query = createQueryChain({
      data: {
        ...validProductRow,
        variants: undefined,
      },
      error: null,
    });
    mockFrom.mockReturnValue(query);
    mockRpc.mockImplementation((...args: unknown[]) => {
      const fn = args[0] as string;
      if (fn === 'get_storefront_product_variants') {
        return Promise.resolve({
          data: [
            {
              id: 'variant-used-128',
              product_id: validProductRow.id,
              condition: 'used',
              sku: null,
              price_override: '540000.00',
              stock_quantity: 0,
              attributes: {
                color: 'Midnight Green',
                storage: '128GB',
              },
              primary_image:
                'https://cdn.example.com/iphone-11-pro-max-midnight-green.avif',
            },
            {
              id: 'variant-used-256',
              product_id: validProductRow.id,
              condition: 'used',
              sku: null,
              price_override: '550000.00',
              stock_quantity: 0,
              attributes: {
                color: 'Midnight Green',
                storage: '256GB',
              },
              primary_image:
                'https://cdn.example.com/iphone-11-pro-max-midnight-green.avif',
            },
          ],
          error: null,
        });
      }

      return Promise.resolve({ data: null, error: null });
    });

    const result = await resolveProductRow('merchant-1', 'iphone-13-pro');

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      { p_product_ids: [validProductRow.id] },
      { count: 'exact' }
    );
    expect(
      (result as { variants: Array<{ id: string }> }).variants.map(
        (variant) => variant.id
      )
    ).toEqual(['variant-used-128', 'variant-used-256']);
    expect(result).toMatchObject({
      variants: expect.arrayContaining([
        expect.objectContaining({
          condition: 'used',
          price_override: '550000.00',
          attributes: expect.objectContaining({
            storage: '256GB',
          }),
        }),
      ]),
    });
  });

  it('resolveProductRow fetches base inventory instead of variants for a simple product', async () => {
    const simpleProduct = {
      ...validProductRow,
      has_variants: false,
      variant_model: 'legacy',
      variants: undefined,
    };
    const query = createQueryChain({ data: simpleProduct, error: null });
    mockFrom.mockReturnValue(query);

    await expect(
      resolveProductRow('merchant-1', 'iphone-13-pro')
    ).resolves.toEqual(simpleProduct);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_base_inventory',
      {
        p_product_ids: [validProductRow.id],
      }
    );
  });

  it('resolveProductRow hydrates sku_matrix rows when has_variants has drifted false', async () => {
    const driftedProduct = {
      ...validProductRow,
      has_variants: false,
      variant_model: 'sku_matrix',
      variants: undefined,
    };
    const query = createQueryChain({ data: driftedProduct, error: null });
    mockFrom.mockReturnValue(query);
    mockRpc.mockImplementationOnce(async () => ({
      data: [
        {
          id: 'variant-drifted',
          product_id: validProductRow.id,
          attributes: { storage: '512GB' },
        },
      ],
      error: null,
    }));

    const result = await resolveProductRow('merchant-1', 'iphone-13-pro');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      variants: [expect.objectContaining({ id: 'variant-drifted' })],
    });
  });

  it('resolveProductRow keeps the product usable when variant hydration throws', async () => {
    const productWithoutEmbeddedVariants = {
      ...validProductRow,
      variants: undefined,
    };
    const query = createQueryChain({
      data: productWithoutEmbeddedVariants,
      error: null,
    });
    mockFrom.mockReturnValue(query);
    mockRpc.mockImplementationOnce(() =>
      Promise.reject(new Error('variant rpc unavailable'))
    );

    await expect(
      resolveProductRow('merchant-1', 'iphone-13-pro')
    ).resolves.toEqual(productWithoutEmbeddedVariants);

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('resolveAndEvictProduct clears stale product caches when a product is gone', async () => {
    const queryClient = {
      removeQueries: jest.fn(),
      setQueriesData: jest.fn(),
    } as unknown as QueryClient;
    const missingQuery = createQueryChain({ data: null, error: null });
    mockFrom.mockReturnValue(missingQuery);

    await expect(
      resolveAndEvictProduct('merchant-1', 'missing-slug', queryClient)
    ).rejects.toThrow(
      'This product is no longer available. Refresh the app to remove outdated product cards.'
    );

    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    });
    const removeQueriesArg = (queryClient.removeQueries as jest.Mock).mock
      .calls[0][0] as {
      predicate: (query: { queryKey: unknown[] }) => boolean;
    };
    const predicate = removeQueriesArg.predicate;
    expect(
      predicate({
        queryKey: [
          'product',
          PRODUCT_QUERY_VERSION,
          'missing-slug',
          'merchant-1',
        ],
      })
    ).toBe(true);
    expect(
      predicate({
        queryKey: ['product', 'missing-slug', 'merchant-1'],
      })
    ).toBe(true);
    expect(
      predicate({
        queryKey: [
          'product',
          PRODUCT_QUERY_VERSION,
          'another-slug',
          'merchant-1',
        ],
      })
    ).toBe(false);
    expect(
      predicate({
        queryKey: ['categories', 'missing-slug'],
      })
    ).toBe(false);
    expect(queryClient.setQueriesData).toHaveBeenCalledTimes(1);

    const updater = (queryClient.setQueriesData as jest.Mock).mock
      .calls[0][1] as (cached: unknown) => unknown;
    expect(updater('cached-pages')).toEqual({
      cached: 'cached-pages',
      slug: 'missing-slug',
    });
    expect(mockRemoveProductSlugFromProductsCache).toHaveBeenCalledWith(
      'cached-pages',
      'missing-slug'
    );
  });

  it('transformProduct converts validated rows and rejects malformed rows', () => {
    expect(transformProduct(validProductRow)).toMatchObject({
      id: validProductRow.id,
      name: validProductRow.name,
      slug: validProductRow.slug,
      image: 'https://cdn.example.com/iphone-13-pro-blue.jpg',
      rating: validProductRow.average_rating,
      review_count: validProductRow.review_count,
      category: 'Phones',
      colors: validProductRow.colors,
      color_images: validProductRow.color_images,
      has_condition_offers: true,
      offers: [
        expect.objectContaining({
          id: 'offer-used',
          condition: 'used',
          price: 510000,
        }),
      ],
      in_stock: true,
    });

    expect(transformProduct({ id: 'bad-id' })).toBeNull();
  });

  it('transformProduct accepts object-based product images from live rows', () => {
    expect(
      transformProduct({
        ...validProductRow,
        images: [
          { url: 'https://cdn.example.com/iphone-13-pro-front.jpg' },
          { src: 'https://cdn.example.com/iphone-13-pro-back.jpg' },
        ],
      })
    ).toMatchObject({
      image: 'https://cdn.example.com/iphone-13-pro-blue.jpg',
      images: [
        'https://cdn.example.com/iphone-13-pro-blue.jpg',
        'https://cdn.example.com/iphone-13-pro-128.jpg',
        'https://cdn.example.com/iphone-13-pro-front.jpg',
        'https://cdn.example.com/iphone-13-pro-back.jpg',
      ],
    });
  });

  it('transformProduct flattens section-array specifications from live product rows', () => {
    expect(
      transformProduct({
        ...validProductRow,
        specifications: [
          {
            category: 'Specs',
            items: [
              { label: 'Brand', value: 'HP' },
              { label: 'RAM', value: '16GB' },
            ],
          },
        ],
      })
    ).toMatchObject({
      specifications: {
        Brand: 'HP',
        RAM: '16GB',
      },
    });
  });

  it('transformProduct uses effective stock when stock_quantity drifted to zero', () => {
    expect(
      transformProduct({
        ...validProductRow,
        stock: 7,
        stock_quantity: 0,
        manage_stock: true,
      })
    ).toMatchObject({
      stock_quantity: 7,
      in_stock: true,
    });
  });

  it('transformProduct canonicalizes legacy condition aliases into display labels', () => {
    expect(
      transformProduct({
        ...validProductRow,
        condition: 'refurbished',
        has_condition_offers: false,
      })
    ).toMatchObject({
      condition: 'Open Box',
    });
  });

  it('transformProduct treats multi-condition sku_matrix products as mixed-condition labels', () => {
    expect(
      transformProduct({
        ...validProductRow,
        condition: 'new',
        has_condition_offers: false,
        available_conditions: ['new', 'used'],
        variant_model: 'sku_matrix',
      })
    ).toMatchObject({
      condition: 'New & Used',
      variant_model: 'sku_matrix',
      available_conditions: ['new', 'used'],
    });
  });

  it('transformProduct merges variant-derived axes into variant_attributes', () => {
    expect(
      transformProduct({
        ...validProductRow,
        variant_attributes: [{ param: 'Storage', options: ['256GB'] }],
        variants: [
          {
            ...validProductRow.variants[0],
            attributes: {
              storage: '128GB',
              ram: '8GB',
            },
          },
          {
            ...validProductRow.variants[0],
            id: 'variant-512gb',
            sku: 'IPHONE-13-PRO-512',
            attributes: {
              storage: '512GB',
              ram: '12GB',
            },
          },
        ],
      })
    ).toMatchObject({
      variant_attributes: {
        storage: ['256GB', '128GB', '512GB'],
        ram: ['8GB', '12GB'],
      },
    });
  });

  it('transformProduct keeps image-backed product colors with exact variant colors', () => {
    expect(
      transformProduct({
        ...validProductRow,
        color: 'Blue',
        colors: ['Blue'],
        color_images: { Blue: ['https://cdn.example.com/generic-blue.jpg'] },
        variant_attributes: [
          { param: 'Color', options: ['Blue'] },
          { param: 'Storage', options: ['128GB', '256GB'] },
        ],
        variants: [
          {
            ...validProductRow.variants[0],
            attributes: {
              color: 'Sapphire Blue',
              color_hex: '#5A7B97',
              storage: '128GB',
            },
          },
          {
            ...validProductRow.variants[0],
            id: 'variant-black-256',
            price_override: 680000,
            attributes: {
              color: 'Onyx Black',
              color_hex: '#1C1C1C',
              storage: '256GB',
            },
          },
        ],
      })
    ).toMatchObject({
      colors: ['Blue', 'Sapphire Blue', 'Onyx Black'],
      variant_attributes: {
        color: ['Blue', 'Sapphire Blue', 'Onyx Black'],
        storage: ['128GB', '256GB'],
      },
      variants: expect.arrayContaining([
        expect.objectContaining({
          attributes: expect.objectContaining({
            color: 'Sapphire Blue',
          }),
        }),
      ]),
    });
  });

  it('transformProduct preserves the legacy scalar color when the colors array is missing', () => {
    const result = transformProduct({
      ...validProductRow,
      color: 'Crimson Red',
      colors: null,
      color_images: null,
      variant_attributes: null,
      variants: null,
      has_variants: false,
    });

    expect(result).not.toBeNull();
    expect(result?.colors).toEqual(['Crimson Red']);
  });

  it('transformProduct surfaces non-variant product colors and color_images', () => {
    // Catalog item that does not use variants but still carries merchant-set
    // color metadata: the resolver should preserve both the color list and the
    // image map so the storefront swatches/gallery render correctly.
    const result = transformProduct({
      ...validProductRow,
      color: 'Cobalt',
      colors: ['Cobalt', 'Sand'],
      color_images: {
        Cobalt: ['https://cdn.example.com/non-variant-cobalt.jpg'],
        Sand: ['https://cdn.example.com/non-variant-sand.jpg'],
      },
      variant_attributes: null,
      variants: null,
      has_variants: false,
    });

    expect(result).not.toBeNull();
    expect(result?.colors).toEqual(['Cobalt', 'Sand']);
    expect(result?.color_images).toEqual({
      Cobalt: ['https://cdn.example.com/non-variant-cobalt.jpg'],
      Sand: ['https://cdn.example.com/non-variant-sand.jpg'],
    });
    expect(result?.has_variants).toBe(false);
  });

  it('transformProduct keeps live variant rows when nested numeric fields arrive as strings', () => {
    expect(
      transformProduct({
        ...validProductRow,
        color: 'Blue',
        colors: ['Blue'],
        color_images: { Blue: ['https://cdn.example.com/generic-blue.jpg'] },
        manage_stock: false,
        variants: [
          {
            ...validProductRow.variants[0],
            price_override: '600000.00',
            stock_quantity: '0',
            attributes: {
              color: 'Sapphire Blue',
              color_hex: '#5A7B97',
              storage: '128GB',
            },
          },
          {
            ...validProductRow.variants[0],
            id: 'variant-black-256',
            price_override: '680000.00',
            stock_quantity: '0',
            attributes: {
              color: 'Onyx Black',
              color_hex: '#1C1C1C',
              storage: '256GB',
            },
          },
        ],
      })
    ).toMatchObject({
      colors: ['Blue', 'Sapphire Blue', 'Onyx Black'],
      manage_stock: false,
      variants: [
        expect.objectContaining({
          attributes: expect.objectContaining({
            color: 'Sapphire Blue',
            storage: '128GB',
          }),
          price_override: 600000,
          stock_quantity: 0,
          // manage_stock: false flips inventoryUnmanaged on, so a stock of 0
          // is not a sold-out signal and the variant must remain purchasable.
          in_stock: true,
        }),
        expect.objectContaining({
          attributes: expect.objectContaining({
            color: 'Onyx Black',
            storage: '256GB',
          }),
          price_override: 680000,
          stock_quantity: 0,
          in_stock: true,
        }),
      ],
    });
  });

  it('transformProduct drops non-string variant metadata while preserving selector attributes', () => {
    const result = transformProduct({
      ...validProductRow,
      color: 'Blue',
      colors: ['Blue'],
      color_images: { Blue: ['https://cdn.example.com/generic-blue.jpg'] },
      manage_stock: false,
      variants: [
        {
          ...validProductRow.variants[0],
          attributes: {
            color: 'Blue',
            storage: '128GB',
            preorder: true,
          },
        },
      ],
    });

    expect(result).toMatchObject({
      variant_attributes: {
        color: ['Blue'],
        storage: ['128GB', '256GB'],
      },
      variants: [
        expect.objectContaining({
          attributes: {
            color: 'Blue',
            storage: '128GB',
          },
        }),
      ],
    });
    expect(result?.variants?.[0]?.attributes).not.toHaveProperty('preorder');
  });

  it('fetchProductsPage applies filters, paginates, and returns transformed products', async () => {
    const rankedResults = [
      {
        product_id: validProductRow.id,
        relevance: 9.8,
        total_count: 3,
      },
      {
        product_id: 'bad-id',
        relevance: 7.9,
        total_count: 3,
      },
    ];
    const query = createQueryChain({
      data: [
        {
          ...validProductRow,
          id: 'bad-id',
        },
        validProductRow,
      ],
      error: null,
    });
    mockRpc.mockImplementation((...args: unknown[]) => {
      const fn = args[0];

      if (fn === 'get_storefront_product_variants') {
        return Promise.resolve({ data: [], error: null });
      }

      return Promise.resolve({
        data: rankedResults,
        error: null,
      });
    });
    mockFrom.mockReturnValue(query);

    const result = await fetchProductsPage(
      'merchant-1',
      {
        category: 'cat-1',
        search: 'iphone14promax',
        condition: 'New',
        brand: 'Apple',
        minPrice: 400000,
        maxPrice: 600000,
        minRating: 4,
        sortBy: 'price_desc',
        limit: 2,
      },
      0
    );

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        brand_filter: 'Apple',
        category_id_filter: 'cat-1',
        condition_filter: 'new',
        max_price_filter: 600000,
        merchant_id_param: 'merchant-1',
        min_price_filter: 400000,
        min_rating_filter: 4,
        result_limit: 2,
        result_offset: 0,
        search_query: 'iphone 14 pro max',
        sort_by: 'price_desc',
        status_filter: 'active',
      })
    );
    expect(query.select).toHaveBeenCalledWith(PRODUCT_SELECT);
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.in).toHaveBeenCalledWith('id', [validProductRow.id, 'bad-id']);
    expect(result).toMatchObject({
      total: 3,
      nextOffset: 2,
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.slug).toBe(validProductRow.slug);
  });

  it('fetchProductsPage throws when the ranked search rpc fails', async () => {
    mockRpc.mockImplementation(async () => ({
      data: null,
      error: new Error('search rpc failed'),
    }));

    await expect(
      fetchProductsPage(
        'merchant-1',
        {
          search: 'iphone14promax',
          limit: 2,
        },
        0
      )
    ).rejects.toThrow('search rpc failed');
  });

  it('fetchProductsPage throws when the ranked product row lookup fails', async () => {
    const query = createQueryChain({
      data: null,
      error: new Error('search rows failed'),
    });

    mockRpc.mockImplementation(async () => ({
      data: [
        {
          product_id: validProductRow.id,
          relevance: 9.8,
          total_count: 1,
        },
      ],
      error: null,
    }));
    mockFrom.mockReturnValue(query);

    await expect(
      fetchProductsPage(
        'merchant-1',
        {
          search: 'iphone14promax',
          limit: 2,
        },
        0
      )
    ).rejects.toThrow('search rows failed');
  });

  it('fetchAvailableBrands returns unique brands across matching rows', async () => {
    const query = createQueryChain({
      data: [
        { brand: 'Samsung' },
        { brand: 'Infinix' },
        { brand: 'Samsung' },
        { brand: null },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    await expect(
      fetchAvailableBrands('merchant-1', {
        category: 'cat-1',
        condition: 'Open Box',
        minPrice: 100000,
      })
    ).resolves.toEqual(['Infinix', 'Samsung']);

    expect(query.select).toHaveBeenCalledWith('brand');
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.eq).toHaveBeenCalledWith('category_id', 'cat-1');
    expect(query.or).toHaveBeenCalledWith(
      'condition.eq.open_box,available_conditions.cs.{open_box}'
    );
    expect(query.gte).toHaveBeenCalledWith('price', 100000);
  });

  it('fetchAvailableBrands normalizes compact search queries before filtering', async () => {
    const query = createQueryChain({
      data: [
        { id: 'prod-2', brand: 'Samsung' },
        { id: 'prod-1', brand: 'Apple' },
      ],
      error: null,
    });
    mockRpc.mockImplementation(async () => ({
      data: [
        { product_id: 'prod-1', relevance: 9.1, total_count: 2 },
        { product_id: 'prod-2', relevance: 8.4, total_count: 2 },
      ],
      error: null,
    }));
    mockFrom.mockReturnValue(query);

    await fetchAvailableBrands('merchant-1', {
      search: 'iphone14promax',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        merchant_id_param: 'merchant-1',
        search_query: 'iphone 14 pro max',
        status_filter: 'active',
      })
    );
    expect(query.in).toHaveBeenCalledWith('id', ['prod-1', 'prod-2']);
  });
});
