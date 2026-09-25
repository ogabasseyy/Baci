import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const mockGetUser = vi.fn();
const mockMerchantSingle = vi.fn();
const mockMappingsOrder = vi.fn();
const mockMappingUpdate = vi.fn();
const mockMappingUpdateIn = vi.fn();
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
          in: (...inArgs: unknown[]) => {
            mockMappingUpdateIn(...inArgs);
            return {
              eq: () => mockMappingUpdate(...args),
            };
          },
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

function reset() {
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
}

/**
 * Shared mock harness for the Jumia product-update route suite, kept in one
 * module so the split suite files stay under the 300-line limit without
 * duplicating the mock graph.
 */
export const updateRouteTestHarness = {
  ids: { INTEGRATION_ID, MERCHANT_ID, PRODUCT_ID },
  mocks: {
    getUser: mockGetUser,
    merchantSingle: mockMerchantSingle,
    mappingsOrder: mockMappingsOrder,
    mappingUpdate: mockMappingUpdate,
    mappingUpdateIn: mockMappingUpdateIn,
    rpc: mockRpc,
    forIntegration: mockForIntegration,
    requireMerchantFeatureAccess: mockRequireMerchantFeatureAccess,
    pushStatusUpdates: mockPushStatusUpdates,
    pushPriceUpdates: mockPushPriceUpdates,
  },
  supabase: mockSupabase,
  makeRequest,
  post: POST,
  loadCurrency: loadJumiaMarketplaceCurrency,
  reset,
};
