import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks — vi.hoisted ensures variables exist before vi.mock hoisting */
/* ------------------------------------------------------------------ */

const {
  mockSelect,
  mockSupabase,
  mockForIntegration,
  mockGetAllProducts,
  mockGetUserAccess,
  mockHasPermission,
  mockRequireMerchantFeatureAccess,
  mockMappingsEq,
  mockCurrencyFixtures,
} = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockMappingsEq = vi.fn();
  const mockMappingsIn = vi.fn().mockResolvedValue({ data: [], error: null });
  const mockCurrencyFixtures = { countryCode: 'NG', payoutCurrency: 'NGN' };
  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'marketplace_integrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        country_code: mockCurrencyFixtures.countryCode,
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    payout_currency: mockCurrencyFixtures.payoutCurrency,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              in: mockSelect,
            }),
          }),
          upsert: () => ({
            select: vi.fn().mockResolvedValue({
              data: [{ id: 'new-1', sku: 'SKU-A' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'jumia_product_mappings') {
        const chain = {
          eq: (...args: unknown[]) => {
            mockMappingsEq(...args);
            return chain;
          },
          in: (...args: unknown[]) => mockMappingsIn(...args),
        };
        return {
          select: () => chain,
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    }),
  };
  const mockForIntegration = vi.fn();
  const mockGetAllProducts = vi.fn();
  const mockGetUserAccess = vi.fn();
  const mockHasPermission = vi.fn();
  const mockRequireMerchantFeatureAccess = vi.fn();
  return {
    mockSelect,
    mockSupabase,
    mockForIntegration,
    mockGetAllProducts,
    mockGetUserAccess,
    mockHasPermission,
    mockRequireMerchantFeatureAccess,
    mockMappingsEq,
    mockCurrencyFixtures,
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
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('@/lib/jumia/catalog', () => ({
  getAllProducts: (...a: unknown[]) => mockGetAllProducts(...a),
}));

vi.mock('@/lib/jumia/client', async () => {
  const { JumiaApiError: RealJumiaApiError } = await vi.importActual<
    typeof import('@/lib/jumia/helpers')
  >('@/lib/jumia/helpers');
  return {
    JumiaClient: {
      forIntegration: (...a: unknown[]) => mockForIntegration(...a),
    },
    JumiaApiError: RealJumiaApiError,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockRequireMerchantFeatureAccess(...args),
}));
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeText: (v: string) => v,
  stripHtmlTags: (v: string) => v,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const INT_ID = '00000000-0000-4000-8000-000000000099';

function makePostRequest(body: unknown) {
  return new NextRequest(
    'http://localhost/api/marketplace/jumia/products/import',
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

describe('Products Import POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrencyFixtures.countryCode = 'NG';
    mockCurrencyFixtures.payoutCurrency = 'NGN';
    mockGetUserAccess.mockResolvedValue({
      merchantId: '00000000-0000-4000-8000-000000000001',
      role: 'owner',
      isOwner: true,
      isStaff: false,
      permissions: {},
    });
    mockHasPermission.mockReturnValue(true);
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
  });

  it('returns 403 on CSRF failure', async () => {
    const { checkCsrfProtection } = await import('@/lib/csrf');
    (checkCsrfProtection as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      response: null,
    });
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const { authenticateApiRequest } = await import('@/lib/api-auth');
    (authenticateApiRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid input', async () => {
    const res = await POST(makePostRequest({ integrationId: 'bad-uuid' }));
    expect(res.status).toBe(400);
  });

  it('returns 402 before creating a Jumia client when marketplace sync is locked', async () => {
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mockRequireMerchantFeatureAccess).toHaveBeenCalledWith(
      mockSupabase,
      '00000000-0000-4000-8000-000000000001',
      'marketplace_sync'
    );
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockGetAllProducts).not.toHaveBeenCalled();
  });

  it('returns 403 before provider work when integrations manage is missing', async () => {
    mockHasPermission.mockReturnValueOnce(false);

    const res = await POST(makePostRequest({ integrationId: INT_ID }));

    expect(res.status).toBe(403);
    expect(mockRequireMerchantFeatureAccess).not.toHaveBeenCalled();
    expect(mockForIntegration).not.toHaveBeenCalled();
  });

  it('returns 404 when JumiaClient.forIntegration throws 404', async () => {
    const { JumiaApiError } = await import('@/lib/jumia/client');
    mockForIntegration.mockRejectedValue(new JumiaApiError(404, 'Not found'));
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(404);
  });

  it('returns 403 when JumiaClient.forIntegration throws 403', async () => {
    const { JumiaApiError } = await import('@/lib/jumia/client');
    mockForIntegration.mockRejectedValue(new JumiaApiError(403, 'Forbidden'));
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(403);
  });

  it('rejects the import when marketplace and merchant currencies differ', async () => {
    mockCurrencyFixtures.countryCode = 'GH';
    mockCurrencyFixtures.payoutCurrency = 'NGN';
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetAllProducts.mockResolvedValue([]);

    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('does not match merchant payout currency');
  });

  it('returns summary with zero totals when Jumia has no products', async () => {
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetAllProducts.mockResolvedValue([]);
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.summary.total).toBe(0);
    expect(json.warnings).toBeUndefined();
  });

  it('returns 500 when Supabase product query fails', async () => {
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetAllProducts.mockResolvedValue([
      {
        id: 'jp-1',
        name: 'Jumia Product',
        description: 'Desc',
        images: [{ url: 'https://img.com/1.jpg' }],
        variations: [{ sellerSku: 'SKU-A', globalPrice: { value: 3000 } }],
      },
    ]);
    mockSelect.mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('returns JSON summary with created/linked counts on success', async () => {
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetAllProducts.mockResolvedValue([
      {
        id: 'jp-1',
        name: 'Jumia Product',
        description: 'Desc',
        images: [{ url: 'https://img.com/1.jpg' }],
        variations: [{ sellerSku: 'SKU-A', globalPrice: { value: 3000 } }],
      },
    ]);
    mockSelect.mockResolvedValue({ data: [], error: null });
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.summary).toBeDefined();
    expect(typeof json.summary.total).toBe('number');
    expect(typeof json.summary.created).toBe('number');
    expect(typeof json.summary.errors).toBe('number');
    // Verify warnings counters are present
    expect(json.warnings).toBeDefined();
    expect(typeof json.warnings.skippedNoSku).toBe('number');
    expect(typeof json.warnings.missingPrice).toBe('number');
  });

  it('increments skippedNoSku when variation has no sellerSku', async () => {
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetAllProducts.mockResolvedValue([
      {
        id: 'jp-1',
        name: 'No SKU Product',
        description: 'Desc',
        images: [],
        variations: [
          { sellerSku: '', globalPrice: { value: 1000 } },
          { sellerSku: null, globalPrice: { value: 2000 } },
        ],
      },
    ]);
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // All variations skipped -- early return with total = jumiaProducts.length
    expect(json.summary.total).toBe(1);
    expect(json.summary.created).toBe(0);
    expect(json.warnings.skippedNoSku).toBe(2);
  });

  it('returns 502 when getAllProducts rejects', async () => {
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetAllProducts.mockRejectedValue(new Error('Jumia API down'));
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch products from Jumia');
  });

  it('increments missingPrice when variation has no globalPrice', async () => {
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetAllProducts.mockResolvedValue([
      {
        id: 'jp-1',
        name: 'No Price Product',
        description: 'Desc',
        images: [],
        variations: [
          { sellerSku: 'SKU-MP', globalPrice: null },
          { sellerSku: 'SKU-MP2', globalPrice: { value: null } },
        ],
      },
    ]);
    const res = await POST(makePostRequest({ integrationId: INT_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // All variations skipped -- early return with total = jumiaProducts.length
    expect(json.summary.total).toBe(1);
    expect(json.summary.created).toBe(0);
    expect(json.warnings.missingPrice).toBe(2);
  });

  it('scopes mapped SKU lookups to the active Jumia integration', async () => {
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-ng',
      marketplaceKey: 'NG',
      getShops: vi.fn().mockResolvedValue([
        {
          id: 'shop-ng',
          businessClients: [{ status: 'active', code: 'NG' }],
        },
      ]),
    });
    mockGetAllProducts.mockResolvedValue([
      {
        id: 'jp-1',
        name: 'Shared SKU Product',
        description: 'Desc',
        images: [],
        variations: [{ sellerSku: 'SHARED-SKU', globalPrice: { value: 1000 } }],
      },
    ]);
    mockSelect.mockResolvedValue({ data: [], error: null });

    const res = await POST(makePostRequest({ integrationId: INT_ID }));

    expect(res.status).toBe(200);
    expect(mockGetAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 'shop-ng' }),
      expect.objectContaining({ status: 'active', shopId: 'shop-ng' })
    );
    expect(mockMappingsEq).toHaveBeenCalledWith('jumia_shop_id', 'shop-ng');
    expect(mockMappingsEq).toHaveBeenCalledWith('marketplace_key', 'NG');
  });

  it('does not send the internal oauth fallback as a Jumia shop filter', async () => {
    mockForIntegration.mockResolvedValue({ shopId: 'oauth' });
    mockGetAllProducts.mockResolvedValue([]);

    const res = await POST(makePostRequest({ integrationId: INT_ID }));

    expect(res.status).toBe(200);
    expect(mockGetAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 'oauth' }),
      { status: 'active' }
    );
  });
});
