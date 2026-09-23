import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks — vi.hoisted ensures variables exist before vi.mock hoisting */
/* ------------------------------------------------------------------ */

const {
  mockRequireMerchantFeatureAccess,
  mockGetUserAccess,
  mockHasPermission,
  mockMaybeSingle,
  mockVariantsResult,
  mockInsert,
  mockMappingIn,
  mockSupabase,
  mockForIntegration,
  mockCreateProduct,
} = vi.hoisted(() => {
  const mockRequireMerchantFeatureAccess = vi.fn();
  const mockGetUserAccess = vi.fn();
  const mockHasPermission = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockVariantsResult = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();
  const mockMappingIn = vi
    .fn()
    .mockImplementation((_column: string, values: unknown[]) =>
      Promise.resolve({
        data: values.map((_, index) => ({
          id: `mapping-${index}`,
          sync_status: 'error',
        })),
        error: null,
      })
    );
  const createMappingChain = () => {
    const chain = {
      eq: vi.fn(),
      neq: vi.fn(),
      in: (...a: unknown[]) => {
        const result = mockMappingIn(...a);
        return Object.assign(result, { select: () => result });
      },
      is: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };
    chain.eq.mockReturnValue(chain);
    chain.neq.mockReturnValue(chain);
    chain.is.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    return chain;
  };
  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'marketplace_integrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { country_code: 'NG' },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'merchants') {
        const chain = {
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { payout_currency: 'NGN' },
            error: null,
          }),
        };
        chain.eq.mockReturnValue(chain);
        return { select: () => chain };
      }
      if (table === 'products') {
        return {
          select: () => {
            const chain = { eq: vi.fn(), maybeSingle: mockMaybeSingle };
            chain.eq.mockReturnValue(chain);
            return chain;
          },
        };
      }
      if (table === 'jumia_product_mappings') {
        return {
          select: () => ({
            eq: () => {
              const chain = createMappingChain();
              chain.eq.mockImplementation((column: string) =>
                column === 'marketplace_key'
                  ? Promise.resolve({ data: [], error: null })
                  : chain
              );
              return chain;
            },
          }),
          insert: (...a: unknown[]) => mockInsert(...a),
          update: (...a: unknown[]) => {
            mockUpdate(...a);
            return createMappingChain();
          },
          delete: () => {
            mockDelete();
            const chain = createMappingChain();
            chain.in = vi.fn().mockResolvedValue({ error: null });
            return chain;
          },
        };
      }
      if (table === 'product_variants') {
        return {
          select: () => ({
            eq: () => ({
              eq: mockVariantsResult,
            }),
          }),
        };
      }
      return {};
    }),
  };
  const mockForIntegration = vi.fn();
  const mockCreateProduct = vi.fn();
  return {
    mockRequireMerchantFeatureAccess,
    mockGetUserAccess,
    mockHasPermission,
    mockMaybeSingle,
    mockVariantsResult,
    mockInsert,
    mockMappingIn,
    mockSupabase,
    mockForIntegration,
    mockCreateProduct,
  };
});

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn().mockResolvedValue({
    user: { id: 'u1' },
    error: null,
    supabase: mockSupabase,
  }),
  getMerchantIdForApiUser: vi
    .fn()
    .mockResolvedValue('00000000-0000-4000-8000-000000000001'),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockRequireMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/jumia/feeds', () => ({
  createProduct: (...a: unknown[]) => mockCreateProduct(...a),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: (...a: unknown[]) => mockForIntegration(...a),
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeText: (v: string) => v,
  stripHtmlTags: (v: string) => v,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const INT_ID = '00000000-0000-4000-8000-000000000099';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000002';

const STORED_PRODUCT = {
  id: PRODUCT_ID,
  name: 'Stored Product',
  description: 'From database',
  price: 5000,
  sku: 'SKU-1',
  stock_quantity: 3,
  stock: 3,
  images: [{ url: 'https://cdn.example.com/stored.jpg' }],
  has_variants: false,
  status: 'active',
};

const VALID_BODY = {
  integrationId: INT_ID,
  productId: PRODUCT_ID,
  name: 'Client Product Name',
  brand: { code: 1, name: 'BrandX' },
  category: { code: 42 },
  variations: [{ sellerSku: 'SKU-1', price: 5000, currency: 'NGN' }],
};

function mockOwnedProductResolution(
  product: typeof STORED_PRODUCT | null = STORED_PRODUCT,
  productError: unknown = null,
  variants: Record<string, unknown>[] = []
) {
  mockMaybeSingle.mockResolvedValue({ data: product, error: productError });
  mockVariantsResult.mockResolvedValue({ data: variants, error: null });
}

function makePostRequest(body: unknown) {
  return new NextRequest(
    'http://localhost/api/marketplace/jumia/products/export',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

import { POST } from './route';

describe('Products Export POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMerchantFeatureAccess.mockReset();
    mockGetUserAccess.mockReset();
    mockHasPermission.mockReset();
    mockMaybeSingle.mockReset();
    mockVariantsResult.mockReset();
    mockInsert.mockReset();
    mockMappingIn.mockReset();
    mockForIntegration.mockReset();
    mockCreateProduct.mockReset();
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
    mockGetUserAccess.mockResolvedValue({
      merchantId: '00000000-0000-4000-8000-000000000001',
    });
    mockHasPermission.mockReturnValue(true);
    mockOwnedProductResolution();
    mockInsert.mockResolvedValue({ error: null });
    mockMappingIn.mockImplementation((_column: string, values: unknown[]) =>
      Promise.resolve({
        data: values.map((_, index) => ({
          id: `mapping-${index}`,
          sync_status: 'error',
        })),
        error: null,
      })
    );
    mockForIntegration.mockResolvedValue({
      shopId: 'shop1',
      marketplaceKey: 'default',
    });
  });

  it('returns 403 on CSRF failure', async () => {
    const { checkCsrfProtection } = await import('@/lib/csrf');
    (checkCsrfProtection as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      response: null,
    });
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it('returns 403 before export lookups when integrations.manage is missing', async () => {
    mockHasPermission.mockReturnValueOnce(false);

    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(403);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockForIntegration).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const { authenticateApiRequest } = await import('@/lib/api-auth');
    (authenticateApiRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid Zod input', async () => {
    const res = await POST(makePostRequest({ integrationId: 'bad' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid input');
  });

  it('returns 402 before exporting products when marketplace sync is locked', async () => {
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.code).toBe('requires_upgrade');
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it('returns 500 before exporting products when marketplace sync entitlement lookup fails', async () => {
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          error: 'Failed to verify merchant plan',
        },
        { status: 500 }
      )
    );

    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to verify merchant plan');
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it('returns 500 when integration currency lookup fails', async () => {
    mockSupabase.from.mockImplementationOnce((table: string) => {
      if (table === 'marketplace_integrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'DB down' },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return mockSupabase.from(table);
    });

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Failed to load Jumia integration currency',
    });
    expect(mockForIntegration).not.toHaveBeenCalled();
  });

  it('returns 404 when the owned product is missing', async () => {
    mockOwnedProductResolution(null);
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Product not found',
    });
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it('returns 500 when owned product lookup fails', async () => {
    mockOwnedProductResolution(null, { message: 'DB connection lost' });
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Failed to load product for Jumia export',
    });
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it('returns matching status when JumiaApiError is thrown', async () => {
    const { JumiaApiError } = await import('@/lib/jumia/helpers');
    mockForIntegration.mockRejectedValue(
      new JumiaApiError(404, 'Integration not found')
    );
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('returns 502 when unknown non-expired error during integration init', async () => {
    mockForIntegration.mockRejectedValue(new Error('unexpected'));
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('uses stored product data when productId is provided', async () => {
    mockForIntegration.mockResolvedValue({
      shopId: 'shop1',
      marketplaceKey: 'default',
    });
    mockCreateProduct.mockResolvedValue('feed-abc');

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.feedId).toBe('feed-abc');
    expect(mockCreateProduct).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 'shop1' }),
      'shop1',
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.objectContaining({ value: 'Stored Product' }),
          description: expect.objectContaining({ value: 'From database' }),
          images: [
            { url: 'https://cdn.example.com/stored.jpg', primary: true },
          ],
        }),
      ])
    );
  });

  it('returns 200 on successful feed creation', async () => {
    mockForIntegration.mockResolvedValue({
      shopId: 'shop1',
      marketplaceKey: 'default',
    });
    mockCreateProduct.mockResolvedValue('feed-abc');
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.feedId).toBe('feed-abc');
    const { checkCsrfProtection } = await import('@/lib/csrf');
    const { authenticateApiRequest } = await import('@/lib/api-auth');
    expect(authenticateApiRequest).toHaveBeenCalled();
    expect(checkCsrfProtection).toHaveBeenCalled();
    expect(mockForIntegration).toHaveBeenCalledWith(
      expect.anything(),
      '00000000-0000-4000-8000-000000000001',
      INT_ID
    );
  });

  it('returns 502 when createProduct fails with an ambiguous transport error', async () => {
    mockForIntegration.mockResolvedValue({
      shopId: 'shop1',
      marketplaceKey: 'default',
    });
    mockCreateProduct.mockRejectedValue(new Error('Feed creation failed'));
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('returns 207 when mapping finalize fails after Jumia accepts the feed', async () => {
    mockCreateProduct.mockResolvedValue('feed-abc');
    mockMappingIn
      .mockResolvedValueOnce({ error: { message: 'update fail' } })
      .mockResolvedValueOnce({ error: { message: 'update fail' } })
      .mockResolvedValueOnce({ data: [{ id: 'mapping-0' }], error: null });
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.partial).toBe(true);
    expect(json.feedId).toBe('feed-abc');
    expect(json.error).toContain('Feed-status reconciliation will recover');
  });

  it('reports when an accepted feed cannot be recorded for reconciliation', async () => {
    mockCreateProduct.mockResolvedValue('feed-abc');
    mockMappingIn
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValue({ error: { message: 'update fail' } });

    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.partial).toBe(true);
    expect(json.feedId).toBe('feed-abc');
    expect(json.error).toContain(
      'automatic reconciliation could not be recorded'
    );
  });

  it('maps exported SKUs to matching variant IDs', async () => {
    mockCreateProduct.mockResolvedValue('feed-abc');
    mockOwnedProductResolution(STORED_PRODUCT, null, [
      { id: 'variant-1', sku: 'SKU-1' },
      { id: 'variant-2', sku: 'SKU-2' },
    ]);
    const body = {
      ...VALID_BODY,
      variations: [
        { sellerSku: 'SKU-1', price: 5000, currency: 'NGN' },
        { sellerSku: 'SKU-2', price: 6000, currency: 'NGN' },
      ],
    };

    const res = await POST(makePostRequest(body));

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          jumia_seller_sku: 'SKU-1',
          variant_id: 'variant-1',
        }),
        expect.objectContaining({
          jumia_seller_sku: 'SKU-2',
          variant_id: 'variant-2',
        }),
      ])
    );
  });

  it('preserves validated variation attributes while ignoring client prices', async () => {
    mockCreateProduct.mockResolvedValue('feed-attributes');
    const body = {
      ...VALID_BODY,
      variations: [
        {
          sellerSku: 'SKU-1',
          price: 1,
          currency: 'NGN',
          attributes: [{ id: 'color', value: 'Blue' }],
        },
      ],
    };

    const res = await POST(makePostRequest(body));

    expect(res.status).toBe(200);
    expect(mockCreateProduct).toHaveBeenCalledWith(expect.anything(), 'shop1', [
      expect.objectContaining({
        variations: [
          expect.objectContaining({
            sellerSku: 'SKU-1',
            globalPrice: { value: 5000, currency: 'NGN' },
            attributes: [{ id: 'color', value: 'Blue' }],
          }),
        ],
      }),
    ]);
  });
});
