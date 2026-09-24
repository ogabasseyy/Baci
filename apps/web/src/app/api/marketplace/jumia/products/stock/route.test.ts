import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetUser = vi.fn();
const mockGetMerchant = vi.fn();
const mockToUserAccess = vi.fn();
const mockForIntegration = vi.fn();
const mockRequireMerchantFeatureAccess = vi.fn();
const mockUpdateStock = vi.fn();
const mockGetFeedStatus = vi.fn();

const mockMappingsSelect = vi.fn();
const mockVariantsIn = vi.fn();
const mockProductsIn = vi.fn();
const mockMappingUpdate = vi.fn();

const mockMappingUpsert = vi.fn().mockResolvedValue({ error: null });
const mappingFilters: Array<{ field: string; value: unknown }> = [];

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: vi.fn((table: string) => {
    if (table === 'jumia_product_mappings') {
      const terminal = {
        order: () => ({ range: () => mockMappingsSelect() }),
      };
      const makeChain = (remainingEq: number, remainingOr: number) => ({
        eq: (field: string, value: unknown) => {
          mappingFilters.push({ field, value });
          return remainingEq === 1 && remainingOr === 0
            ? terminal
            : makeChain(remainingEq - 1, remainingOr);
        },
        or: (filter: string) => {
          mappingFilters.push({ field: 'or', value: filter });
          return remainingOr === 1 && remainingEq === 0
            ? terminal
            : makeChain(remainingEq, remainingOr - 1);
        },
      });
      return {
        select: () => makeChain(4, 2),
        update: (...args: unknown[]) => {
          // Supports both the single-eq tracking write (awaited directly)
          // and the guarded reconcile write (.eq().eq().select().maybeSingle()).
          const chain = {} as {
            eq: (...eqArgs: unknown[]) => unknown;
            select: (...selectArgs: unknown[]) => unknown;
            maybeSingle: () => unknown;
            then: (
              resolve: (value: unknown) => void,
              reject: (reason?: unknown) => void
            ) => unknown;
          };
          chain.eq = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = () => mockMappingUpdate(...args);
          // biome-ignore lint/suspicious/noThenProperty: mirrors supabase-js query builders, thenable at any point in the chain.
          chain.then = (resolve, reject) =>
            (mockMappingUpdate(...args) as Promise<unknown>).then(
              resolve,
              reject
            );
          return chain;
        },
        upsert: (...args: unknown[]) => mockMappingUpsert(...args),
      };
    }
    if (table === 'product_variants') {
      return {
        select: () => ({ eq: () => ({ in: () => mockVariantsIn() }) }),
      };
    }
    if (table === 'products') {
      return {
        select: () => ({ eq: () => ({ in: () => mockProductsIn() }) }),
      };
    }
    return {};
  }),
};

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => mockGetMerchant(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));
vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: (...args: unknown[]) => mockForIntegration(...args),
  },
  JumiaApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  jumiaErrorResponse: vi.fn(),
}));
vi.mock('@/lib/jumia/feeds', () => ({
  updateStock: (...args: unknown[]) => mockUpdateStock(...args),
  getFeedStatus: (...args: unknown[]) => mockGetFeedStatus(...args),
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockRequireMerchantFeatureAccess(...args),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const INT_ID = '00000000-0000-4000-8000-000000000099';
const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';

function makeRequest(integrationId?: string): NextRequest {
  const url = integrationId
    ? `http://localhost/api/marketplace/jumia/products/stock?integrationId=${integrationId}`
    : 'http://localhost/api/marketplace/jumia/products/stock';
  return new NextRequest(url, { method: 'POST' });
}

function setupAuth() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockGetMerchant.mockResolvedValue({ merchantId: MERCHANT_ID });
  mockToUserAccess.mockReturnValue({ role: 'owner' });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

const { POST } = await import('./route');

describe('POST /api/marketplace/jumia/products/stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mappingFilters.length = 0;
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(401);
  });

  it('returns 400 when integrationId is missing', async () => {
    setupAuth();

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('integrationId is required');
  });

  it('returns 400 when integrationId is not a valid UUID', async () => {
    setupAuth();

    const res = await POST(makeRequest('not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid integrationId');
  });

  it('returns 402 before creating a Jumia client when marketplace sync is locked', async () => {
    setupAuth();
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const res = await POST(makeRequest(INT_ID));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mockRequireMerchantFeatureAccess).toHaveBeenCalledWith(
      mockSupabase,
      MERCHANT_ID,
      'marketplace_sync'
    );
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockUpdateStock).not.toHaveBeenCalled();
  });

  it('returns success with updated: 0 when no mappings exist', async () => {
    setupAuth();
    mockMappingsSelect.mockResolvedValue({ data: [], error: null });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(0);
    expect(mappingFilters).toEqual(
      expect.arrayContaining([{ field: 'marketplace_key', value: 'default' }])
    );
  });

  it('returns 500 with generic message when mappings query fails', async () => {
    setupAuth();
    mockMappingsSelect.mockResolvedValue({
      data: null,
      error: { message: 'DB connection lost' },
    });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch product mappings');
    // Should NOT leak the internal DB error message
    expect(JSON.stringify(body)).not.toContain('DB connection lost');
  });

  it('pushes stock update when stock has changed (product-only mapping)', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: 'SKU-001',
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: 5,
        },
      ],
      error: null,
    });
    // stock_quantity=10, stock=0 → getEffectiveStock returns 10
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'p1', stock: 0, stock_quantity: 10 }],
      error: null,
    });
    mockUpdateStock.mockResolvedValue('feed-123');
    mockMappingUpdate.mockResolvedValue({ data: { id: 'm1' }, error: null });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.feedId).toBe('feed-123');
    expect(mockUpdateStock).toHaveBeenCalledOnce();
    // Verify scoped tracking update includes updated stock for delta detection
    expect(mockMappingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        baci_stock_at_last_sync: 10,
        last_feed_id: 'feed-123',
      })
    );
    expect(mockMappingUpsert).not.toHaveBeenCalled();
  });

  it('uses stock_quantity over legacy stock when both present', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: 'SKU-001',
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: 3, // different from resolved stock
        },
      ],
      error: null,
    });
    // stock_quantity=15 (authoritative), legacy stock=3
    // getEffectiveStock returns stock_quantity when it's non-zero
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'p1', stock: 3, stock_quantity: 15 }],
      error: null,
    });
    mockUpdateStock.mockResolvedValue('feed-456');
    mockMappingUpdate.mockResolvedValue({ data: { id: 'm1' }, error: null });

    const res = await POST(makeRequest(INT_ID));
    const body = await res.json();
    expect(body.updated).toBe(1);
    // The pushed stock should be 15 (stock_quantity), not 3 (legacy stock)
    expect(mockUpdateStock).toHaveBeenCalledWith(expect.anything(), [
      { sellerSku: 'SKU-001', id: 'JP-001', stock: 15 },
    ]);
  });

  it('skips when stock has not changed', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: 'SKU-001',
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: 10,
        },
      ],
      error: null,
    });
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'p1', stock: 0, stock_quantity: 10 }],
      error: null,
    });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(0);
    expect(mockUpdateStock).not.toHaveBeenCalled();
  });

  it('skips mappings with missing seller SKU', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: null,
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: null,
        },
      ],
      error: null,
    });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('pushes stock update for variant-level mapping', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm2',
          product_id: 'p1',
          variant_id: 'v1',
          jumia_seller_sku: 'SKU-V1',
          jumia_product_id: 'JP-V1',
          baci_stock_at_last_sync: 3,
        },
      ],
      error: null,
    });
    mockVariantsIn.mockResolvedValue({
      data: [{ id: 'v1', stock_quantity: 8 }],
      error: null,
    });
    mockUpdateStock.mockResolvedValue('feed-var-1');

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.feedId).toBe('feed-var-1');
    expect(mockUpdateStock).toHaveBeenCalledWith(expect.anything(), [
      { sellerSku: 'SKU-V1', id: 'JP-V1', stock: 8 },
    ]);
    // Should NOT call the products table for variant mappings
    expect(mockProductsIn).not.toHaveBeenCalled();
  });

  it('returns 500 when Jumia API call fails', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: 'SKU-001',
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: null,
        },
      ],
      error: null,
    });
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'p1', stock: 0, stock_quantity: 5 }],
      error: null,
    });
    mockUpdateStock.mockRejectedValue(new Error('Jumia API timeout'));

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Stock sync failed');
  });

  it('reports failure instead of up-to-date when stock lookups fail', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: 'SKU-001',
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: null,
          last_feed_id: null,
        },
      ],
      error: null,
    });
    mockProductsIn.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.updated).toBe(0);
    expect(body.fetchErrors).toBe(1);
    expect(body.message).toContain('could not read current inventory');
    expect(mockUpdateStock).not.toHaveBeenCalled();
  });

  it('re-pushes mappings whose previously accepted stock feed was rejected', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: 'SKU-001',
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: 5,
          last_feed_id: 'feed-rejected',
        },
      ],
      error: null,
    });
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'p1', stock: 0, stock_quantity: 5 }],
      error: null,
    });
    mockGetFeedStatus.mockResolvedValue({
      status: 'failed',
      total: 1,
      completed: 0,
      failed: 1,
      feedItems: [],
    });
    mockUpdateStock.mockResolvedValue('feed-retry');
    mockMappingUpdate.mockResolvedValue({ data: { id: 'm1' }, error: null });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.feedId).toBe('feed-retry');
    // Cursor reset (NULL) precedes the fresh tracking write for the retry.
    expect(mockMappingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ baci_stock_at_last_sync: null })
    );
    expect(mockMappingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        baci_stock_at_last_sync: 5,
        last_feed_id: 'feed-retry',
      })
    );
  });

  it('skips unchanged stock when the prior stock feed was accepted', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mockMappingsSelect.mockResolvedValue({
      data: [
        {
          id: 'm1',
          product_id: 'p1',
          variant_id: null,
          jumia_seller_sku: 'SKU-001',
          jumia_product_id: 'JP-001',
          baci_stock_at_last_sync: 5,
          last_feed_id: 'feed-accepted',
        },
      ],
      error: null,
    });
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'p1', stock: 0, stock_quantity: 5 }],
      error: null,
    });
    mockGetFeedStatus.mockResolvedValue({
      status: 'completed',
      total: 1,
      completed: 1,
      failed: 0,
      feedItems: [],
    });
    mockMappingUpdate.mockResolvedValue({ data: { id: 'm1' }, error: null });

    const res = await POST(makeRequest(INT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(0);
    expect(mockUpdateStock).not.toHaveBeenCalled();
    // Confirmation clears the feed pointer without touching the cursor.
    expect(mockMappingUpdate).toHaveBeenCalledWith({ last_feed_id: null });
  });
});
