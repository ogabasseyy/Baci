import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateAnonClient = vi.fn();

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => mockCreateAnonClient(),
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

type DomainResult = { data: { domain: string } | null; error: unknown };
type ProductsResult = {
  data: Record<string, unknown>[] | null;
  error: unknown;
};
type ManifestResult = {
  data: Record<string, unknown>[] | null;
  error: unknown;
};
type VariantRpcResult = {
  data: Record<string, unknown>[] | null;
  error: unknown;
};
type OffersResult = {
  data: Record<string, unknown>[] | null;
  error: unknown;
};

let domainResult: DomainResult;
let productsResult: ProductsResult;
let manifestResult: ManifestResult;
let variantRpcResult: VariantRpcResult;
let offersResult: OffersResult;
let nullCreatedAtProductsResult: ProductsResult;
const mockManifestEq = vi.fn();
const mockManifestIn = vi.fn();
const mockManifestOrder = vi.fn();
const mockManifestRange = vi.fn();
const mockOffersIn = vi.fn();
const mockRpc = vi.fn();
const mockOffersStatusEq = vi.fn();
const mockProductsGt = vi.fn();
const mockProductsIs = vi.fn();
const mockProductsOr = vi.fn();
const mockProductsNot = vi.fn();
const mockProductsOrder = vi.fn();
const mockProductsLimit = vi.fn();
let productQueryMode: 'non_null' | 'null' = 'non_null';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function flushMicrotasks(cycles = 10) {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await Promise.resolve();
  }
}

function createMockSupabase() {
  return {
    rpc: mockRpc,
    from: (table: string) => {
      if (table === 'domains') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve(domainResult),
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'products') {
        return {
          select: () => {
            const query = {
              eq: () => query,
              not: (column: string, operator: string, value: unknown) => {
                productQueryMode = 'non_null';
                mockProductsNot(column, operator, value);
                return query;
              },
              is: (column: string, value: unknown) => {
                if (column === 'created_at' && value === null) {
                  productQueryMode = 'null';
                }
                mockProductsIs(column, value);
                return query;
              },
              gt: (column: string, value: string) => {
                mockProductsGt(column, value);
                return query;
              },
              or: (filter: string) => {
                mockProductsOr(filter);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockProductsOrder(column, options);
                return query;
              },
              limit: (value: number) => mockProductsLimit(value),
            };

            return query;
          },
        };
      }

      if (table === 'product_feed_images') {
        return {
          select: () => {
            const query = {
              eq: (column: string, value: unknown) => {
                mockManifestEq(column, value);
                return query;
              },
              in: (column: string, ids: string[]) => {
                mockManifestIn(column, ids);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockManifestOrder(column, options);
                return query;
              },
              range: (from: number, to: number) => mockManifestRange(from, to),
            };

            return query;
          },
        };
      }

      if (table === 'product_offers') {
        return {
          select: () => ({
            in: (column: string, ids: string[]) => {
              mockOffersIn(column, ids);
              return {
                eq: (status: string) => mockOffersStatusEq(status, ids),
              };
            },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  productQueryMode = 'non_null';
  mockProductsLimit.mockImplementation(() => ({
    overrideTypes: () =>
      Promise.resolve(
        productQueryMode === 'null'
          ? nullCreatedAtProductsResult
          : productsResult
      ),
  }));

  domainResult = {
    data: { domain: 'ogabassey.com' },
    error: null,
  };
  productsResult = {
    data: [
      {
        id: 'product-1',
        name: 'Phone',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    error: null,
  };
  nullCreatedAtProductsResult = { data: [], error: null };
  manifestResult = {
    data: [
      {
        product_id: 'product-1',
        verified_url: 'https://cdn.example.com/phone.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 0,
      },
      {
        product_id: 'product-1',
        verified_url: 'https://cdn.example.com/phone-side.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: false,
        position: 1,
      },
    ],
    error: null,
  };
  variantRpcResult = {
    data: [],
    error: null,
  };
  offersResult = {
    data: [],
    error: null,
  };
  mockManifestRange.mockImplementation(() => ({
    overrideTypes: () => Promise.resolve(manifestResult),
  }));
  mockOffersStatusEq.mockImplementation(() => Promise.resolve(offersResult));
  mockRpc.mockResolvedValue(variantRpcResult);
  mockCreateAnonClient.mockReturnValue(createMockSupabase());
});

describe('getCachedGoogleMerchantFeedData', () => {
  it('returns custom_domain from the primary domain lookup', async () => {
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.custom_domain).toBe('ogabassey.com');
  });

  it('returns null custom_domain when no primary domain exists', async () => {
    domainResult = { data: null, error: null };
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.custom_domain).toBeNull();
  });

  it('returns products as FeedProduct[]', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Phone',
          color: 'Black',
          product_key_specs: {
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
      error: null,
    };

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );
    expect(result.products[0]).toMatchObject({
      id: 'product-1',
      name: 'Phone',
      color: 'Black',
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 256,
      },
      variants: [],
    });
  });

  it('preserves canonical_url for Google and agent feed URL parity', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Phone',
          canonical_url: '/gift-cards/phone',
          category: 'Phones',
          slug: 'phone',
        },
      ],
      error: null,
    };

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.products[0]).toMatchObject({
      canonical_url: '/gift-cards/phone',
    });
  });

  it('selects the direct category relation for canonical feed URLs', async () => {
    const { FEED_PRODUCTS_SELECT } = await import('./feed-query');

    expect(FEED_PRODUCTS_SELECT).toContain(
      'categories:category_id(name, slug)'
    );
    expect(FEED_PRODUCTS_SELECT).toContain(
      'product_categories(categories(name, slug))'
    );
    expect(FEED_PRODUCTS_SELECT).not.toContain('category_slug');
  });

  it('paginates active products with a stable cursor beyond the first Supabase page', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `product-${index}`,
      name: `Phone ${index}`,
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    productsResult = {
      data: fullPage,
      error: null,
    };
    mockProductsLimit
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: fullPage,
            error: null,
          } satisfies ProductsResult),
      }))
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: [{ id: 'product-1000', name: 'Phone 1000' }],
            error: null,
          } satisfies ProductsResult),
      }));

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockProductsLimit).toHaveBeenCalledTimes(3);
    expect(mockProductsLimit).toHaveBeenNthCalledWith(1, 1000);
    expect(mockProductsLimit).toHaveBeenNthCalledWith(2, 1000);
    expect(mockProductsOr).toHaveBeenCalledWith(
      'created_at.lt.2026-01-01T00:00:00.000Z,and(created_at.eq.2026-01-01T00:00:00.000Z,id.gt.product-999)'
    );
    expect(mockProductsIs).toHaveBeenCalledWith('created_at', null);
    expect(mockProductsOrder).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(mockProductsOrder).toHaveBeenCalledWith('id', { ascending: true });
    expect(result.products).toHaveLength(1001);
  });

  it('continues pagination across null created_at pages', async () => {
    productsResult = { data: [], error: null };
    const nullFullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `product-${index}`,
      name: `Phone ${index}`,
      created_at: null,
    }));
    mockProductsLimit
      .mockImplementationOnce(() => ({
        overrideTypes: () => Promise.resolve({ data: [], error: null }),
      }))
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: nullFullPage,
            error: null,
          } satisfies ProductsResult),
      }))
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: [
              { id: 'product-1000', name: 'Phone 1000', created_at: null },
            ],
            error: null,
          } satisfies ProductsResult),
      }));

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockProductsLimit).toHaveBeenCalledTimes(3);
    expect(mockProductsIs).toHaveBeenCalledWith('created_at', null);
    expect(mockProductsGt).toHaveBeenCalledWith('id', 'product-999');
    expect(result.products).toHaveLength(1001);
  });

  it('caps product pagination at the variant RPC product-id limit', async () => {
    const TOTAL_PRODUCTS_FOR_VARIANT_CAP = 10_000;
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `product-${index}`,
      name: `Phone ${index}`,
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    productsResult = {
      data: fullPage,
      error: null,
    };
    mockProductsLimit.mockImplementation(() => ({
      overrideTypes: () =>
        Promise.resolve({
          data: fullPage.map((product, index) => ({
            ...product,
            id: `product-${
              (mockProductsLimit.mock.calls.length - 1) * 1000 + index
            }`,
          })),
          error: null,
        } satisfies ProductsResult),
    }));

    const {
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      getCachedGoogleMerchantFeedData,
    } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockProductsLimit).toHaveBeenCalledTimes(10);
    expect(mockProductsLimit).toHaveBeenLastCalledWith(1000);
    expect(mockRpc).toHaveBeenCalledTimes(
      Math.ceil(
        TOTAL_PRODUCTS_FOR_VARIANT_CAP / FEED_PRODUCT_VARIANTS_BATCH_SIZE
      )
    );
    const rpcProductIds = mockRpc.mock.calls.flatMap(([, rpcArgs]) =>
      Array.isArray(rpcArgs?.p_product_ids) ? rpcArgs.p_product_ids : []
    );
    expect(rpcProductIds).toHaveLength(TOTAL_PRODUCTS_FOR_VARIANT_CAP);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'get_feed_product_variants', {
      p_merchant_id: 'merchant-1',
      p_product_ids: Array.from(
        { length: FEED_PRODUCT_VARIANTS_BATCH_SIZE },
        (_, index) => `product-${index}`
      ),
    });
    expect(result.products).toHaveLength(TOTAL_PRODUCTS_FOR_VARIANT_CAP);
  });

  it('batches variant RPC product IDs to avoid PostgREST result truncation', async () => {
    const products = Array.from({ length: 201 }, (_, index) => ({
      id: `product-${index}`,
      name: `Phone ${index}`,
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    productsResult = {
      data: products,
      error: null,
    };
    mockRpc.mockImplementation(async (_functionName, args) => ({
      data: [
        {
          id: `variant-${args.p_product_ids[0]}`,
          product_id: args.p_product_ids[0],
          condition: 'new',
          attributes: { storage: '64GB' },
          price_override: 100000,
          sku: null,
          stock_quantity: 1,
        },
      ],
      error: null,
    }));

    const {
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      getCachedGoogleMerchantFeedData,
    } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockRpc).toHaveBeenCalledTimes(5);
    expect(
      mockRpc.mock.calls.map(([, rpcArgs]) => rpcArgs.p_product_ids.length)
    ).toEqual([
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      1,
    ]);
    expect(result.products[0]?.variants).toEqual([
      {
        id: 'variant-product-0',
        condition: 'new',
        attributes: { storage: '64GB' },
        price_override: 100000,
        sku: null,
        stock_quantity: 1,
      },
    ]);
  });

  it('limits concurrent variant RPC batches', async () => {
    const products = Array.from({ length: 251 }, (_, index) => ({
      id: `product-${index}`,
      name: `Phone ${index}`,
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    productsResult = {
      data: products,
      error: null,
    };
    const startedBatchSizes: number[] = [];
    const deferredRpcResults: ReturnType<
      typeof createDeferred<VariantRpcResult>
    >[] = [];
    mockRpc.mockImplementation((_functionName, args) => {
      const deferred = createDeferred<VariantRpcResult>();
      deferredRpcResults.push(deferred);
      startedBatchSizes.push(args.p_product_ids.length);
      return deferred.promise;
    });

    const {
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES,
      getCachedGoogleMerchantFeedData,
    } = await import('./feed-data');
    const resultPromise = getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    await flushMicrotasks();

    expect(FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES).toBe(4);
    expect(startedBatchSizes).toEqual([
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
    ]);
    expect(deferredRpcResults).toHaveLength(
      FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES
    );

    deferredRpcResults[0]?.resolve({ data: [], error: null });

    await flushMicrotasks();

    expect(startedBatchSizes).toEqual([
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
    ]);

    for (const deferred of deferredRpcResults.slice(1, 4)) {
      deferred.resolve({ data: [], error: null });
    }

    await flushMicrotasks();

    expect(startedBatchSizes).toEqual([
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      FEED_PRODUCT_VARIANTS_BATCH_SIZE,
      1,
    ]);
    deferredRpcResults[4]?.resolve({ data: [], error: null });
    deferredRpcResults[5]?.resolve({ data: [], error: null });

    const result = await resultPromise;
    expect(result.products).toHaveLength(251);
  });

  it('hydrates feed variants from the feed RPC', async () => {
    variantRpcResult = {
      data: [
        {
          id: 'variant-1',
          product_id: 'product-1',
          condition: 'used',
          attributes: { storage: '256GB' },
          price_override: 600000,
          sku: 'PHONE-USED-256',
          stock_quantity: 2,
        },
      ],
      error: null,
    };
    mockRpc.mockResolvedValue(variantRpcResult);

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockRpc).toHaveBeenCalledWith('get_feed_product_variants', {
      p_merchant_id: 'merchant-1',
      p_product_ids: ['product-1'],
    });
    expect(result.products[0]?.variants).toEqual([
      {
        id: 'variant-1',
        condition: 'used',
        attributes: { storage: '256GB' },
        price_override: 600000,
        sku: 'PHONE-USED-256',
        stock_quantity: 2,
      },
    ]);
  });

  it('initializes feed products with an empty variants array when the RPC returns no rows', async () => {
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.products[0]?.variants).toEqual([]);
  });

  it('throws when the variant RPC fails', async () => {
    variantRpcResult = { data: null, error: { message: 'rpc error' } };
    mockRpc.mockResolvedValue(variantRpcResult);

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');

    await expect(
      getCachedGoogleMerchantFeedData('merchant-1', 'ogabassey')
    ).rejects.toThrow('Failed to fetch product variants');
  });

  it('flattens joined product_categories(categories(name, slug)) into categories and category_slug', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Phone',
          product_categories: [
            {
              categories: {
                name: 'Phones',
                slug: 'phones',
              },
            },
          ],
        },
      ],
      error: null,
    };

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.products[0]).toMatchObject({
      id: 'product-1',
      name: 'Phone',
      variants: [],
      categories: {
        name: 'Phones',
        slug: 'phones',
      },
      category_slug: 'phones',
      category: 'Phones',
    });
  });

  it('prefers direct category_id relation over product_categories for canonical URLs', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Nintendo eShop Card',
          category: 'Nintendo Switch',
          categories: {
            name: 'Gift Cards',
            slug: 'gift-cards',
          },
          product_categories: [
            {
              categories: {
                name: 'Gaming',
                slug: 'gaming',
              },
            },
          ],
          slug: 'nintendo-eshop-card',
        },
      ],
      error: null,
    };

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.products[0]).toMatchObject({
      category: 'Nintendo Switch',
      category_slug: 'gift-cards',
      categories: {
        name: 'Gift Cards',
        slug: 'gift-cards',
      },
    });
  });

  it('normalizes missing category_slug to null when no joined category exists', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Phone',
        },
      ],
      error: null,
    };

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.products[0]).toMatchObject({
      id: 'product-1',
      name: 'Phone',
      categories: null,
      category: null,
      category_slug: null,
    });
  });

  it('skips product_offers hydration for sku_matrix products', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Phone',
          variant_model: 'sku_matrix',
          has_condition_offers: true,
        },
      ],
      error: null,
    };

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockOffersStatusEq).not.toHaveBeenCalled();
    expect(result.products[0]?.offers).toBeUndefined();
  });

  it('hydrates product_offers for legacy products that use them', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Phone',
          variant_model: 'legacy',
          has_condition_offers: true,
        },
      ],
      error: null,
    };
    offersResult = {
      data: [
        {
          id: 'offer-1',
          product_id: 'product-1',
          condition: 'used',
          price: 420000,
          stock_quantity: 3,
        },
      ],
      error: null,
    };
    mockOffersStatusEq.mockResolvedValue(offersResult);

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockOffersStatusEq).toHaveBeenCalled();
    expect(result.products[0]?.offers).toEqual([
      {
        id: 'offer-1',
        condition: 'used',
        price: 420000,
        stock_quantity: 3,
        images: undefined,
        compare_at_price: null,
      },
    ]);
  });

  it('batches product_offers queries to avoid oversized in filters', async () => {
    productsResult = {
      data: Array.from({ length: 251 }, (_, index) => ({
        id: `product-${index}`,
        name: `Phone ${index}`,
        variant_model: 'legacy',
        has_condition_offers: true,
      })),
      error: null,
    };
    mockOffersStatusEq.mockImplementation((_status: string, ids: string[]) =>
      Promise.resolve({
        data: ids.slice(0, 1).map((id) => ({
          id: `offer-${id}`,
          product_id: id,
          condition: 'used',
          price: 420000,
          stock_quantity: 3,
        })),
        error: null,
      } satisfies OffersResult)
    );

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockOffersIn).toHaveBeenCalledTimes(2);
    expect(mockOffersIn.mock.calls[0]?.[1]).toHaveLength(250);
    expect(mockOffersIn.mock.calls[1]?.[1]).toHaveLength(1);
    expect(
      result.products.find((product) => product.id === 'product-0')?.offers
    ).toEqual([
      {
        id: 'offer-product-0',
        condition: 'used',
        price: 420000,
        stock_quantity: 3,
        images: undefined,
        compare_at_price: null,
      },
    ]);
    expect(
      result.products.find((product) => product.id === 'product-250')?.offers
    ).toEqual([
      {
        id: 'offer-product-250',
        condition: 'used',
        price: 420000,
        stock_quantity: 3,
        images: undefined,
        compare_at_price: null,
      },
    ]);
  });

  it('throws when the offers query fails', async () => {
    productsResult = {
      data: [
        {
          id: 'product-1',
          name: 'Phone',
          variant_model: 'legacy',
          has_condition_offers: true,
        },
      ],
      error: null,
    };
    offersResult = { data: null, error: { message: 'offers error' } };
    mockOffersStatusEq.mockResolvedValue(offersResult);

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');

    await expect(
      getCachedGoogleMerchantFeedData('merchant-1', 'ogabassey')
    ).rejects.toThrow('Failed to fetch product offers');
  });

  it('groups manifest rows by product_id into imageManifest', async () => {
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.imageManifest['product-1']).toHaveLength(2);
    expect(result.imageManifest['product-1'][0]).toEqual({
      variant_id: null,
      verified_url: 'https://cdn.example.com/phone.jpg',
      verified_format: 'jpeg',
      status: 'verified',
      is_primary: true,
      position: 0,
    });
    expect(result.imageManifest['product-1'][1]).toEqual({
      variant_id: null,
      verified_url: 'https://cdn.example.com/phone-side.jpg',
      verified_format: 'jpeg',
      status: 'verified',
      is_primary: false,
      position: 1,
    });
  });

  it('preserves variant_id on variant-scoped image manifest rows', async () => {
    manifestResult = {
      data: [
        {
          product_id: 'product-1',
          variant_id: 'variant-blue-128',
          verified_url: 'https://cdn.example.com/blue-front.jpg',
          verified_format: 'jpeg',
          status: 'verified',
          is_primary: true,
          position: 0,
        },
      ],
      error: null,
    };
    mockManifestRange.mockImplementation(() => ({
      overrideTypes: () => Promise.resolve(manifestResult),
    }));

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.imageManifest['product-1']).toEqual([
      {
        variant_id: 'variant-blue-128',
        verified_url: 'https://cdn.example.com/blue-front.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 0,
      },
    ]);
  });

  it('fetches verified image manifest rows only for active product id chunks', async () => {
    const activeProducts = Array.from({ length: 251 }, (_, index) => ({
      id: `product-${index}`,
      name: `Phone ${index}`,
    }));
    productsResult = {
      data: activeProducts,
      error: null,
    };

    mockManifestRange
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: [
              {
                product_id: 'product-0',
                verified_url: 'https://cdn.example.com/phone-0.jpg',
                verified_format: 'jpeg',
                status: 'verified',
                is_primary: true,
                position: 0,
              },
            ],
            error: null,
          }),
      }))
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: [
              {
                product_id: 'product-250',
                verified_url: 'https://cdn.example.com/phone-250.jpg',
                verified_format: 'jpeg',
                status: 'verified',
                is_primary: true,
                position: 0,
              },
            ],
            error: null,
          }),
      }));

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockManifestIn).toHaveBeenCalledTimes(2);
    expect(mockManifestIn).toHaveBeenNthCalledWith(
      1,
      'product_id',
      activeProducts.slice(0, 250).map((product) => product.id)
    );
    expect(mockManifestIn).toHaveBeenNthCalledWith(2, 'product_id', [
      'product-250',
    ]);
    expect(mockManifestRange).toHaveBeenCalledTimes(2);
    expect(mockManifestRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockManifestRange).toHaveBeenNthCalledWith(2, 0, 999);
    expect(result.imageManifest['product-0']).toHaveLength(1);
    expect(result.imageManifest['product-250']).toHaveLength(1);
  });

  it('limits concurrent verified image manifest batch queries', async () => {
    const firstProductPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `product-${index}`,
      name: `Phone ${index}`,
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    const secondProductPage = [
      {
        id: 'product-1000',
        name: 'Phone 1000',
        created_at: '2025-12-31T00:00:00.000Z',
      },
    ];
    let rangeCallIndex = 0;
    const {
      FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES,
      getCachedGoogleMerchantFeedData,
    } = await import('./feed-data');
    const deferredManifestResults = Array.from(
      { length: FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES },
      () => createDeferred<ManifestResult>()
    );

    mockProductsLimit
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: firstProductPage,
            error: null,
          } satisfies ProductsResult),
      }))
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({
            data: secondProductPage,
            error: null,
          } satisfies ProductsResult),
      }));
    mockManifestRange.mockImplementation(() => {
      const callIndex = rangeCallIndex;
      rangeCallIndex += 1;

      if (callIndex < deferredManifestResults.length) {
        return {
          overrideTypes: () => deferredManifestResults[callIndex].promise,
        };
      }

      return {
        overrideTypes: () =>
          Promise.resolve({ data: [], error: null } satisfies ManifestResult),
      };
    });

    const resultPromise = getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    await flushMicrotasks();

    expect(mockManifestRange).toHaveBeenCalledTimes(
      FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES
    );
    expect(
      mockManifestIn.mock.calls.map(([, productIds]) => productIds.length)
    ).toEqual(
      Array.from(
        { length: FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES },
        () => 250
      )
    );

    for (const deferredResult of deferredManifestResults) {
      deferredResult.resolve({ data: [], error: null });
    }

    const result = await resultPromise;

    expect(mockManifestRange).toHaveBeenCalledTimes(5);
    expect(
      mockManifestIn.mock.calls.map(([, productIds]) => productIds.length)
    ).toEqual([
      ...Array.from(
        { length: FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES },
        () => 250
      ),
      1,
    ]);
    expect(result.products).toHaveLength(1001);
  });

  it('paginates each active product image chunk with deterministic ordering', async () => {
    productsResult = {
      data: [
        { id: 'product-1', name: 'Phone 1' },
        { id: 'product-2', name: 'Phone 2' },
      ],
      error: null,
    };
    const firstManifestPage = Array.from({ length: 1000 }, (_, index) => ({
      product_id: index === 0 ? 'product-1' : 'product-2',
      verified_url: `https://cdn.example.com/image-${index}.jpg`,
      verified_format: 'jpeg',
      status: 'verified',
      is_primary: index === 0,
      position: index,
    }));
    const secondManifestPage = [
      {
        product_id: 'product-2',
        verified_url: 'https://cdn.example.com/phone-2-extra.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: false,
        position: 1000,
      },
    ];

    mockManifestRange
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({ data: firstManifestPage, error: null }),
      }))
      .mockImplementationOnce(() => ({
        overrideTypes: () =>
          Promise.resolve({ data: secondManifestPage, error: null }),
      }));

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockManifestIn).toHaveBeenCalledWith('product_id', [
      'product-1',
      'product-2',
    ]);
    expect(mockManifestOrder).toHaveBeenCalledWith('product_id', {
      ascending: true,
    });
    expect(mockManifestOrder).toHaveBeenCalledWith('position', {
      ascending: true,
    });
    expect(mockManifestOrder).toHaveBeenCalledWith('id', { ascending: true });
    expect(mockManifestRange).toHaveBeenCalledTimes(2);
    expect(mockManifestRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockManifestRange).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(result.imageManifest['product-1']).toHaveLength(1);
    expect(result.imageManifest['product-2']).toHaveLength(1000);
  });

  it('scopes manifest queries to active feed products', async () => {
    manifestResult = {
      data: [
        {
          product_id: 'product-1',
          verified_url: 'https://cdn.example.com/phone.jpg',
          verified_format: 'jpeg',
          status: 'verified',
          is_primary: true,
          position: 0,
        },
      ],
      error: null,
    };
    mockManifestRange.mockImplementation(() => ({
      overrideTypes: () => Promise.resolve(manifestResult),
    }));

    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(mockManifestIn).toHaveBeenCalledWith('product_id', ['product-1']);
    expect(mockManifestEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(result.imageManifest['product-1']).toHaveLength(1);
  });

  it('returns empty imageManifest when no products exist (short-circuit)', async () => {
    productsResult = { data: [], error: null };
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');
    const result = await getCachedGoogleMerchantFeedData(
      'merchant-1',
      'ogabassey'
    );

    expect(result.products).toEqual([]);
    expect(result.imageManifest).toEqual({});
  });

  it('throws when domain query fails', async () => {
    domainResult = { data: null, error: { message: 'connection error' } };
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');

    await expect(
      getCachedGoogleMerchantFeedData('merchant-1', 'ogabassey')
    ).rejects.toThrow('Failed to fetch merchant domain');
  });

  it('throws when products query fails', async () => {
    productsResult = { data: null, error: { message: 'query error' } };
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');

    await expect(
      getCachedGoogleMerchantFeedData('merchant-1', 'ogabassey')
    ).rejects.toThrow('Failed to fetch products');
  });

  it('throws when manifest query fails', async () => {
    manifestResult = { data: null, error: { message: 'manifest error' } };
    mockManifestRange.mockImplementation(() => ({
      overrideTypes: () => Promise.resolve(manifestResult),
    }));
    const { getCachedGoogleMerchantFeedData } = await import('./feed-data');

    await expect(
      getCachedGoogleMerchantFeedData('merchant-1', 'ogabassey')
    ).rejects.toThrow('Failed to fetch image manifest');
  });
});
