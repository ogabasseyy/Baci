import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const rpc = vi.fn();

const merchantBuilder = {
  eq: vi.fn(() => merchantBuilder),
  maybeSingle: vi.fn(),
  select: vi.fn(() => merchantBuilder),
};
const candidateBuilder = {
  eq: vi.fn(() => candidateBuilder),
  order: vi.fn(() => candidateBuilder),
  range: vi.fn(),
};
const hydrateBuilder = {
  eq: vi.fn(() => hydrateBuilder),
  in: vi.fn(),
};
const productsBuilder = {
  select: vi.fn((projection: string) =>
    projection === 'id' ? candidateBuilder : hydrateBuilder
  ),
};
const variantsBuilder = {
  eq: vi.fn(() => variantsBuilder),
  in: vi.fn(() => variantsBuilder),
  order: vi.fn(),
  select: vi.fn(() => variantsBuilder),
};
const from = vi.fn((table: string) => {
  if (table === 'merchants') return merchantBuilder;
  if (table === 'products') return productsBuilder;
  if (table === 'product_variants') return variantsBuilder;
  return {};
});

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

const { GET } = await import('./route');

const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
const VARIANT_ID = '66666666-6666-4666-8666-666666666666';

const baseProduct = {
  condition: 'new',
  default_variant_id: null,
  has_variants: false,
  id: PRODUCT_ID,
  images: [{ url: 'https://cdn.example.com/iphone.png' }],
  manage_stock: true,
  merchant_id: 'merchant-1',
  name: 'iPhone 15 Pro Max',
  price: '2100000',
  stock: 8,
  stock_quantity: 0,
};

describe('GET /api/merchant/quiz/prize-products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { from, rpc },
      user: { id: 'user-1' },
    });
    mockGetUserAccess.mockResolvedValue({
      merchantId: 'merchant-1',
      permissions: {},
      role: 'owner',
    });
    mockHasPermission.mockReturnValue(true);
    merchantBuilder.maybeSingle.mockResolvedValue({
      data: { slug: 'ogabassey' },
      error: null,
    });
    candidateBuilder.range.mockResolvedValue({
      data: [{ id: PRODUCT_ID }],
      error: null,
    });
    hydrateBuilder.in.mockResolvedValue({ data: [baseProduct], error: null });
    variantsBuilder.order.mockResolvedValue({ data: [], error: null });
    rpc.mockResolvedValue({
      data: [{ product_id: PRODUCT_ID, relevance: 4, total_count: 101 }],
      error: null,
    });
  });

  it('authenticates and checks permission before accepting query input', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    const response = await GET(
      new Request('http://localhost/api?limit=999&cursor=bad')
    );

    expect(response.status).toBe(401);
    expect(mockGetUserAccess).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('denies missing access and marketing permission before inventory work', async () => {
    mockGetUserAccess.mockResolvedValueOnce(null);
    expect((await GET(new Request('http://localhost/api'))).status).toBe(404);

    mockGetUserAccess.mockResolvedValueOnce({ merchantId: 'merchant-1' });
    mockHasPermission.mockReturnValueOnce(false);
    expect((await GET(new Request('http://localhost/api'))).status).toBe(403);
    expect(productsBuilder.select).not.toHaveBeenCalled();
  });

  it('rejects non-Ogabassey tenants and invalid bounded pagination', async () => {
    merchantBuilder.maybeSingle.mockResolvedValueOnce({
      data: { slug: 'another-store' },
      error: null,
    });
    expect((await GET(new Request('http://localhost/api'))).status).toBe(403);

    const invalid = await GET(
      new Request('http://localhost/api?cursor=12&offset=12')
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid query' });

    for (const cursor of ['-1', '1.5']) {
      const response = await GET(
        new Request(`http://localhost/api?cursor=${cursor}`)
      );
      expect(response.status).toBe(400);
    }
    expect(candidateBuilder.range).not.toHaveBeenCalled();
  });

  it('returns a small initial page with legacy effective stock', async () => {
    const response = await GET(new Request('http://localhost/api'));

    expect(response.status).toBe(200);
    expect(candidateBuilder.range).toHaveBeenCalledWith(0, 12);
    expect(candidateBuilder.order).toHaveBeenCalledWith('id', {
      ascending: true,
    });
    expect(productsBuilder.select).not.toHaveBeenCalledWith('id', {
      count: 'exact',
    });
    expect(hydrateBuilder.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(await response.json()).toEqual({
      nextCursor: null,
      products: [
        expect.objectContaining({
          available: true,
          effectiveStock: 8,
          id: PRODUCT_ID,
          selectionId: `${PRODUCT_ID}:product`,
        }),
      ],
      total: null,
    });
  });

  it('uses ranked search and supports inventory beyond product 100', async () => {
    const response = await GET(
      new Request('http://localhost/api?search=Galaxy&offset=100&limit=1')
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('search_products_v2', {
      merchant_id_param: 'merchant-1',
      parent_only: false,
      result_limit: 2,
      result_offset: 100,
      search_query: 'Galaxy',
      sort_by: 'relevance',
      status_filter: 'active',
    });
    expect((await response.json()).nextCursor).toBe(null);
  });

  it('never exceeds the requested limit after expanding variants', async () => {
    const secondVariantId = '77777777-7777-4777-8777-777777777777';
    hydrateBuilder.in.mockResolvedValue({
      data: [{ ...baseProduct, has_variants: true }],
      error: null,
    });
    variantsBuilder.order.mockResolvedValue({
      data: [
        {
          attributes: { color: 'Blue' },
          condition: 'new',
          created_at: '2026-08-01T10:00:00.000Z',
          id: VARIANT_ID,
          images: [],
          merchant_id: 'merchant-1',
          price_override: null,
          primary_image: null,
          product_id: PRODUCT_ID,
          sku: null,
          stock_quantity: 2,
        },
        {
          attributes: { color: 'Black' },
          condition: 'new',
          created_at: '2026-08-01T09:00:00.000Z',
          id: secondVariantId,
          images: [],
          merchant_id: 'merchant-1',
          price_override: null,
          primary_image: null,
          product_id: PRODUCT_ID,
          sku: null,
          stock_quantity: 'not-a-number',
        },
      ],
      error: null,
    });

    const firstResponse = await GET(
      new Request('http://localhost/api?limit=1')
    );
    const firstPage = await firstResponse.json();
    expect(firstPage.products).toHaveLength(1);
    expect(variantsBuilder.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(firstPage.products[0]).toMatchObject({
      variantId: secondVariantId,
    });
    expect(firstPage.nextCursor).toMatch(/^\d+$/);
    expect(firstPage.total).toBeNull();

    const secondResponse = await GET(
      new Request(`http://localhost/api?limit=1&cursor=${firstPage.nextCursor}`)
    );
    const secondPage = await secondResponse.json();
    expect(secondPage.products).toHaveLength(1);
    expect(secondPage.products[0]).toMatchObject({
      available: true,
      effectiveStock: 2,
      variantId: VARIANT_ID,
    });
    expect(Number.isNaN(secondPage.products[0].effectiveStock)).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('does not return an unselectable parent when variant inventory is missing', async () => {
    hydrateBuilder.in.mockResolvedValueOnce({
      data: [{ ...baseProduct, has_variants: true }],
      error: null,
    });
    variantsBuilder.order.mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(
      new Request('http://localhost/api?search=Phone')
    );

    expect(await response.json()).toEqual({
      nextCursor: null,
      products: [],
      total: null,
    });
  });

  it('drops cross-merchant hydration rows even if the database response is wrong', async () => {
    hydrateBuilder.in.mockResolvedValueOnce({
      data: [{ ...baseProduct, merchant_id: 'merchant-2' }],
      error: null,
    });
    const payload = await (
      await GET(new Request('http://localhost/api'))
    ).json();

    expect(payload.products).toEqual([]);
  });

  it('returns a schema-valid empty page with an exact zero total', async () => {
    candidateBuilder.range.mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(new Request('http://localhost/api'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nextCursor: null,
      products: [],
      total: 0,
    });
  });

  it('returns a stable failure when ranked search or hydration fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    expect(
      (await GET(new Request('http://localhost/api?search=iPhone'))).status
    ).toBe(500);

    hydrateBuilder.in.mockResolvedValueOnce({
      data: null,
      error: { message: 'offline' },
    });
    expect((await GET(new Request('http://localhost/api'))).status).toBe(500);
  });
});
