import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockProductSingle = vi.fn();
const mockIntegrationSingle = vi.fn();
const mockMappingsOrder = vi.fn();

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: vi.fn((table: string) => {
    if (table === 'products') {
      const productQuery = {
        eq: vi.fn(),
        single: mockProductSingle,
      };
      productQuery.eq.mockReturnValue(productQuery);
      return {
        select: () => productQuery,
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
      };
    }

    if (table === 'marketplace_integrations') {
      const integrationQuery = {
        eq: vi.fn(),
        single: mockIntegrationSingle,
      };
      integrationQuery.eq.mockReturnValue(integrationQuery);
      return {
        select: () => integrationQuery,
      };
    }

    return {};
  }),
};

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));
vi.mock('@/lib/api-auth', () => ({
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
const INTEGRATION_ID = '00000000-0000-4000-8000-000000000099';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000002';
const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';

function makeRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return new NextRequest(
    `http://localhost/api/marketplace/jumia/products?${params.toString()}`
  );
}

const { GET } = await import('./route');

describe('GET /api/marketplace/jumia/products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGetUserAccess.mockResolvedValue({
      merchantId: MERCHANT_ID,
      role: 'owner',
      isOwner: true,
      isStaff: false,
      permissions: {},
    });
    mockHasPermission.mockReturnValue(true);
    mockProductSingle.mockResolvedValue({
      data: { merchant_id: MERCHANT_ID },
      error: null,
    });
    mockIntegrationSingle.mockResolvedValue({
      data: { shop_id: 'shop-1', marketplace_key: 'NG' },
      error: null,
    });
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );

    expect(response.status).toBe(401);
  });

  it('returns 400 when integrationId is missing for authenticated callers', async () => {
    const response = await GET(makeRequest({ productId: PRODUCT_ID }));
    expect(response.status).toBe(400);
  });

  it('returns 403 before product lookup when integrations view is missing', async () => {
    mockHasPermission.mockReturnValueOnce(false);

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );

    expect(response.status).toBe(403);
    expect(mockProductSingle).not.toHaveBeenCalled();
  });

  it('allows view-only staff to read mappings without refreshing credentials', async () => {
    mockHasPermission.mockImplementation(
      (_access: unknown, _resource: unknown, action: unknown) =>
        action === 'view'
    );
    mockMappingsOrder.mockResolvedValue({ data: [], error: null });

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mapping: null, mappings: [] });
  });

  it('returns 404 when the Jumia integration is not found', async () => {
    mockIntegrationSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'missing' },
    });

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: `Jumia integration not found: ${INTEGRATION_ID}`,
    });
  });

  it('returns 500 when the integration lookup fails', async () => {
    mockIntegrationSingle.mockResolvedValue({
      data: null,
      error: { message: 'network down' },
    });

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );

    expect(response.status).toBe(500);
  });

  it('returns 500 when scoped mapping lookup fails', async () => {
    mockMappingsOrder.mockResolvedValue({
      data: null,
      error: { message: 'db unavailable' },
    });

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'Failed to fetch mapping',
    });
  });

  it('returns 404 when the product is missing', async () => {
    mockProductSingle.mockResolvedValue({
      data: null,
      error: { message: 'not found' },
    });

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'Product not found' });
  });

  it('returns the primary integration-scoped mapping', async () => {
    mockMappingsOrder.mockResolvedValue({
      data: [
        {
          id: 'map-variant',
          product_id: PRODUCT_ID,
          variant_id: 'variant-1',
          jumia_sku: 'SKU-V1',
          jumia_seller_sku: 'SKU-V1',
          jumia_product_id: 'JUMIA-V1',
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
        {
          id: 'map-primary',
          product_id: PRODUCT_ID,
          variant_id: null,
          jumia_sku: 'SKU-MAIN',
          jumia_seller_sku: 'SKU-MAIN',
          jumia_product_id: 'JUMIA-MAIN',
          jumia_price: 1200,
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

    const response = await GET(
      makeRequest({ productId: PRODUCT_ID, integrationId: INTEGRATION_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mapping.jumia_sku).toBe('SKU-MAIN');
    expect(body.mappings).toHaveLength(2);
    expect(mockIntegrationSingle).toHaveBeenCalled();
  });
});
