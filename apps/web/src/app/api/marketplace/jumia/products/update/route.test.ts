import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockMerchantSingle = vi.fn();
const mockMappingsOrder = vi.fn();
const mockMappingUpdate = vi.fn();
const mockRpc = vi.fn();
const mockForIntegration = vi.fn();
const mockRequireMerchantFeatureAccess = vi.fn();
const mockPushStatusUpdates = vi.fn();
const mockPushPriceUpdates = vi.fn();

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: vi.fn((table: string) => {
    if (table === 'merchants') {
      return {
        select: () => ({
          eq: () => ({
            single: mockMerchantSingle,
          }),
        }),
      };
    }

    if (table === 'jumia_product_mappings') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: mockMappingsOrder,
                }),
              }),
            }),
          }),
        }),
        update: (...args: unknown[]) => ({
          eq: () => ({
            eq: () => mockMappingUpdate(...args),
          }),
          in: () => ({
            eq: () => mockMappingUpdate(...args),
          }),
        }),
      };
    }

    return {};
  }),
  rpc: (...args: unknown[]) => mockRpc(...args),
};

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: (...args: unknown[]) => mockForIntegration(...args),
  },
}));
vi.mock('@/lib/jumia/feeds', () => ({
  updatePrice: vi.fn(),
  updateStatus: vi.fn(),
}));
vi.mock('./jumia-product-update-feeds', async () => {
  const actual = await vi.importActual<
    typeof import('./jumia-product-update-feeds')
  >('./jumia-product-update-feeds');
  return {
    ...actual,
    pushStatusUpdates: (...args: unknown[]) => mockPushStatusUpdates(...args),
    pushPriceUpdates: (...args: unknown[]) => mockPushPriceUpdates(...args),
  };
});
vi.mock('@/lib/jumia/jumia-marketplace-currency', () => ({
  loadJumiaMarketplaceCurrency: vi.fn(),
}));
vi.mock('@/lib/jumia/helpers', () => ({
  JumiaApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
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

const INTEGRATION_ID = '00000000-0000-4000-8000-000000000099';
const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000002';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost/api/marketplace/jumia/products/update',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

const { POST } = await import('./route');
const { loadJumiaMarketplaceCurrency } = await import(
  '@/lib/jumia/jumia-marketplace-currency'
);

describe('POST /api/marketplace/jumia/products/update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockMerchantSingle.mockResolvedValue({
      data: { id: MERCHANT_ID },
      error: null,
    });
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'NG',
    });
    mockMappingsOrder.mockResolvedValue({
      data: [
        {
          id: 'map-1',
          product_id: PRODUCT_ID,
          variant_id: null,
          jumia_sku: 'SKU-1',
          jumia_seller_sku: 'SKU-1',
          jumia_product_id: 'JUMIA-1',
          jumia_price: 1000,
          jumia_sale_price: null,
          jumia_sale_start: null,
          jumia_sale_end: null,
          is_active: true,
          sync_inventory: true,
          sync_price: false,
          sync_status: 'synced',
          last_synced_at: null,
          sync_error: null,
          created_at: '2026-08-13T10:00:00Z',
          updated_at: '2026-08-13T10:00:00Z',
        },
      ],
      error: null,
    });
    mockMappingUpdate.mockResolvedValue({ error: null });
    mockPushStatusUpdates.mockResolvedValue(undefined);
    mockPushPriceUpdates.mockResolvedValue(undefined);
    mockRpc.mockResolvedValue({ error: null });
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(
      makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false },
        productId: PRODUCT_ID,
      })
    );

    expect(response.status).toBe(401);
  });

  it('returns 402 before reading mappings or creating a Jumia client when marketplace sync is locked', async () => {
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const response = await POST(
      makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mockRequireMerchantFeatureAccess).toHaveBeenCalledWith(
      mockSupabase,
      MERCHANT_ID,
      'marketplace_sync'
    );
    expect(mockSupabase.from).not.toHaveBeenCalledWith(
      'jumia_product_mappings'
    );
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockMappingUpdate).not.toHaveBeenCalled();
    expect(mockPushStatusUpdates).not.toHaveBeenCalled();
    expect(mockPushPriceUpdates).not.toHaveBeenCalled();
  });

  it('returns before updating mappings when marketplace currency loading fails for price updates', async () => {
    const { loadJumiaMarketplaceCurrency } = await import(
      '@/lib/jumia/jumia-marketplace-currency'
    );
    vi.mocked(loadJumiaMarketplaceCurrency).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'Failed to load Jumia integration currency',
    });

    const response = await POST(
      makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { jumia_price: 1500 },
        productId: PRODUCT_ID,
      })
    );

    expect(response.status).toBe(500);
    expect(mockMappingUpdate).not.toHaveBeenCalled();
    expect(mockPushPriceUpdates).not.toHaveBeenCalled();
  });

  it('does not persist overrides when a mapped variant is not ready on Jumia', async () => {
    mockMappingsOrder.mockResolvedValueOnce({
      data: [
        {
          id: 'map-pending',
          product_id: PRODUCT_ID,
          variant_id: 'variant-1',
          jumia_product_id: null,
          jumia_sku: 'SKU-1',
          jumia_price: 1000,
          jumia_sale_price: null,
          jumia_sale_start: null,
          jumia_sale_end: null,
        },
      ],
      error: null,
    });

    const response = await POST(
      makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false, jumia_price: 900 },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      feedIds: [],
      errors: [
        'Status update skipped: product has not been assigned a Jumia product ID yet (feed may still be processing)',
        'Price update skipped: product has not been assigned a Jumia product ID yet (feed may still be processing)',
      ],
    });
    expect(mockMappingUpdate).not.toHaveBeenCalled();
    expect(mockPushStatusUpdates).not.toHaveBeenCalled();
    expect(mockPushPriceUpdates).not.toHaveBeenCalled();
  });

  it('verifies OAuth scope before mutating mappings', async () => {
    mockForIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'oauth',
    });

    const response = await POST(
      makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      feedIds: [],
      errors: ['Unable to verify the Jumia shop marketplace scope. Try again.'],
    });
    expect(mockMappingUpdate).not.toHaveBeenCalled();
    expect(mockPushStatusUpdates).not.toHaveBeenCalled();
    expect(mockPushPriceUpdates).not.toHaveBeenCalled();
  });

  it('persists variant prices after the price feed is accepted', async () => {
    vi.mocked(loadJumiaMarketplaceCurrency).mockResolvedValue({
      ok: true,
      currency: 'NGN',
    });

    const response = await POST(
      makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { jumia_prices: { 'SKU-1': 900 } },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPushPriceUpdates).toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith('apply_jumia_variant_price_updates', {
      p_merchant_id: MERCHANT_ID,
      p_updates: [{ id: 'map-1', price: 900 }],
    });
  });

  it('skips variant price persistence when the price feed fails', async () => {
    vi.mocked(loadJumiaMarketplaceCurrency).mockResolvedValue({
      ok: true,
      currency: 'NGN',
    });
    mockPushPriceUpdates.mockImplementationOnce(async (...args: unknown[]) => {
      (args[5] as string[]).push('Price feed rejected');
    });

    const response = await POST(
      makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { jumia_prices: { 'SKU-1': 900 } },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.errors).toEqual(['Price feed rejected']);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
