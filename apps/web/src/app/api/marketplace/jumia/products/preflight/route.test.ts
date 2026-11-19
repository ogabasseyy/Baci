import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getMerchant: vi.fn(),
  toUserAccess: vi.fn(),
  hasPermission: vi.fn(),
  featureGate: vi.fn(),
  csrf: vi.fn(),
  forIntegration: vi.fn(),
  getAllCategories: vi.fn(),
  getAllBrands: vi.fn(),
  getAttributeSet: vi.fn(),
  digest: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mocks.authenticate(...args),
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => mocks.getMerchant(...args),
  toUserAccess: (...args: unknown[]) => mocks.toUserAccess(...args),
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mocks.featureGate(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mocks.csrf(...args),
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: (...args: unknown[]) => mocks.forIntegration(...args),
  },
}));
vi.mock('@/lib/jumia/catalog', () => ({
  getAllCategories: (...args: unknown[]) => mocks.getAllCategories(...args),
  getAllBrands: (...args: unknown[]) => mocks.getAllBrands(...args),
  getAttributeSet: (...args: unknown[]) => mocks.getAttributeSet(...args),
}));
vi.mock('@/lib/jumia/product-preflight-digest', () => ({
  computeJumiaProductPreflightDigest: (...args: unknown[]) =>
    mocks.digest(...args),
}));

const { POST } = await import('./route');

const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const INTEGRATION_ID = '00000000-0000-4000-8000-000000000002';
const SELECTION_ID = '00000000-0000-4000-8000-000000000003';
const CATEGORY_ID = '00000000-0000-4000-8000-000000000004';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000005';
const ATTRIBUTE_SET_ID = '00000000-0000-4000-8000-000000000006';
const IMAGE_ID = '00000000-0000-4000-8000-000000000007';
const SECOND_PRODUCT_ID = '00000000-0000-4000-8000-000000000008';
const USER_ID = 'user-id';

function requestBody() {
  return {
    merchantId: MERCHANT_ID,
    integrationId: INTEGRATION_ID,
    businessClientCode: 'NG-RETAIL',
    selectionId: SELECTION_ID,
    sourceCategoryId: CATEGORY_ID,
    sourcePage: { page: 1, limit: 50 },
    products: [{ productId: PRODUCT_ID, sourceVersion: 'a'.repeat(64) }],
    mappings: [
      {
        productId: PRODUCT_ID,
        category: { code: 123, name: 'Gaming / Consoles' },
        brand: { code: 456, name: 'Nintendo' },
        attributeSetId: ATTRIBUTE_SET_ID,
        attributes: {},
        bullets: [
          'Play at home and on the go',
          'Vibrant OLED screen',
          'Comfortable handheld controls',
          'Connects to a television',
        ],
        categoryConfirmed: true,
      },
    ],
  };
}

function sourceProjection() {
  return {
    contractVersion: 1,
    product: {
      id: PRODUCT_ID,
      merchantId: MERCHANT_ID,
      status: 'active',
      hasVariants: false,
      variantModel: null,
      updatedAt: '2026-10-01T00:00:00Z',
      name: 'Nintendo Switch OLED Console',
      description: 'A handheld gaming console with an OLED display.',
      sku: 'SWITCH-OLED',
      exportImages: [],
      price: 300,
      stock: 5,
      stockQuantity: 5,
      manageStock: true,
      inventoryTrackingPolicy: 'off',
      inventoryAnchorVariantId: null,
      condition: 'new',
      weightValue: 0.5,
      weightUnit: 'kg',
      categoryId: CATEGORY_ID,
    },
    categoryMemberships: [{ id: CATEGORY_ID, name: 'Gaming', isActive: true }],
    variants: [],
    images: [
      {
        id: IMAGE_ID,
        variantId: null,
        status: 'verified',
        verifiedUrl: 'https://images.example.test/console.jpg',
        verifiedFormat: 'jpg',
        isPrimary: true,
        position: 0,
        verifiedAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ],
  };
}

function pageData(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    selectionId: SELECTION_ID,
    sourceCategoryId: CATEGORY_ID,
    total: 1,
    page: 1,
    limit: 50,
    totalPages: 1,
    products: [
      {
        id: PRODUCT_ID,
        ordinal: 1,
        capturedSourceVersion: 'a'.repeat(64),
        currentSourceVersion: 'a'.repeat(64),
        available: true,
        unavailableReason: null,
        product: sourceProjection(),
      },
    ],
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new NextRequest(
    'http://localhost/api/marketplace/jumia/products/preflight',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

function setupAuthorized() {
  const rpc = vi.fn().mockResolvedValue({ data: pageData(), error: null });
  const supabase = { rpc, from: vi.fn() };
  const client = {
    integrationId: INTEGRATION_ID,
    merchantId: MERCHANT_ID,
    shopId: 'shop-1',
    countryCode: 'NG',
    marketplaceKey: 'jumia-ng',
    request: vi.fn(),
    getShops: vi.fn().mockResolvedValue([
      {
        id: 'shop-1',
        name: 'Synthetic Shop',
        email: 'shop@example.test',
        businessClients: [
          {
            code: 'NG-RETAIL',
            name: 'Nigeria Retail',
            countryCode: 'NG',
            countryName: 'Nigeria',
            status: 'active',
            shortCode: 'NG',
          },
        ],
      },
    ]),
  };
  mocks.authenticate.mockResolvedValue({
    user: { id: USER_ID },
    supabase,
    error: null,
  });
  mocks.getMerchant.mockResolvedValue({ merchantId: MERCHANT_ID });
  mocks.toUserAccess.mockReturnValue({ merchantId: MERCHANT_ID });
  mocks.hasPermission.mockReturnValue(true);
  mocks.featureGate.mockResolvedValue(null);
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.forIntegration.mockResolvedValue(client);
  mocks.getAllCategories.mockResolvedValue([
    {
      code: 123,
      name: 'Gaming / Consoles',
      completePath: 'Gaming / Consoles',
      hasChildren: false,
      attributeSet: { sid: ATTRIBUTE_SET_ID, name: 'Gaming' },
    },
  ]);
  mocks.getAllBrands.mockResolvedValue([{ code: 456, name: 'Nintendo' }]);
  mocks.getAttributeSet.mockResolvedValue({ attributes: [] });
  mocks.digest.mockReturnValue(`jumia-preflight-v1:${'a'.repeat(64)}`);
  return { rpc, supabase, client };
}

describe('Jumia canonical product preflight route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthorized();
  });

  it('requires authentication and CSRF before querying a selection', async () => {
    mocks.authenticate.mockResolvedValueOnce({
      user: null,
      supabase: null,
      error: new Error('unauthorized'),
    });
    const unauthorized = await POST(makeRequest(requestBody()));
    expect(unauthorized.status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.forIntegration).not.toHaveBeenCalled();

    const { rpc } = setupAuthorized();
    mocks.csrf.mockResolvedValueOnce({
      valid: false,
      response: Response.json(
        { error: 'CSRF validation failed' },
        { status: 403 }
      ),
    });
    const forbidden = await POST(makeRequest(requestBody()));
    expect(forbidden.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON, caller evidence, and unauthorized merchant actions before the RPC', async () => {
    const { rpc } = setupAuthorized();
    const malformed = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/preflight',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        }
      )
    );
    expect(malformed.status).toBe(400);

    const forged = requestBody() as ReturnType<typeof requestBody> & {
      globalPrice: { currency: string; value: number };
    };
    forged.globalPrice = { currency: 'USD', value: 300 };
    expect((await POST(makeRequest(forged))).status).toBe(400);

    mocks.hasPermission.mockReturnValueOnce(false);
    expect((await POST(makeRequest(requestBody()))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.forIntegration).not.toHaveBeenCalled();
  });

  it('requires feature entitlement and an active integration scoped to the selected merchant', async () => {
    const { rpc } = setupAuthorized();
    mocks.featureGate.mockResolvedValueOnce(
      Response.json({ code: 'requires_upgrade' }, { status: 402 })
    );
    expect((await POST(makeRequest(requestBody()))).status).toBe(402);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.forIntegration).not.toHaveBeenCalled();

    const { rpc: integrationRpc } = setupAuthorized();
    mocks.forIntegration.mockRejectedValueOnce(new Error('not found'));
    expect((await POST(makeRequest(requestBody()))).status).toBe(404);
    expect(integrationRpc).toHaveBeenCalledOnce();
  });

  it('rejects cross-merchant, non-Nigeria, foreign shop/client, or wrong-destination integrations', async () => {
    const { rpc } = setupAuthorized();
    mocks.getMerchant.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(requestBody()))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();

    const { rpc: foreignMerchantRpc } = setupAuthorized();
    mocks.getMerchant.mockResolvedValueOnce({
      merchantId: '00000000-0000-4000-8000-000000000009',
    });
    expect((await POST(makeRequest(requestBody()))).status).toBe(403);
    expect(foreignMerchantRpc).not.toHaveBeenCalled();

    const { rpc: nonNigeriaRpc, client: nonNigeriaClient } = setupAuthorized();
    mocks.forIntegration.mockResolvedValueOnce({
      ...nonNigeriaClient,
      countryCode: 'GH',
    });
    expect((await POST(makeRequest(requestBody()))).status).toBe(409);
    expect(nonNigeriaRpc).toHaveBeenCalledOnce();

    const { rpc: foreignShopRpc, client } = setupAuthorized();
    client.getShops.mockResolvedValueOnce([]);
    expect((await POST(makeRequest(requestBody()))).status).toBe(409);
    expect(foreignShopRpc).toHaveBeenCalledOnce();

    const { rpc: foreignClientRpc, client: notNigeria } = setupAuthorized();
    notNigeria.getShops.mockResolvedValueOnce([
      {
        id: 'shop-1',
        name: 'Synthetic Shop',
        email: 'shop@example.test',
        businessClients: [
          {
            code: 'NG-RETAIL',
            name: 'Nigeria Retail',
            countryCode: 'GH',
            countryName: 'Ghana',
            status: 'active',
            shortCode: 'GH',
          },
        ],
      },
    ]);
    mocks.forIntegration.mockResolvedValueOnce(notNigeria);
    expect((await POST(makeRequest(requestBody()))).status).toBe(409);
    expect(foreignClientRpc).toHaveBeenCalledOnce();
  });

  it('rejects projection drift and never substitutes missing canonical facts', async () => {
    const { rpc } = setupAuthorized();
    const projection = sourceProjection();
    const { weightUnit: _weightUnit, ...withoutWeightUnit } =
      projection.product;
    rpc.mockResolvedValueOnce({
      data: pageData({
        products: [
          {
            ...pageData().products[0],
            product: { ...projection, product: withoutWeightUnit },
          },
        ],
      }),
      error: null,
    });
    const missingProjectionField = await POST(makeRequest(requestBody()));
    expect(missingProjectionField.status).toBe(409);
    expect(mocks.getAllCategories).not.toHaveBeenCalled();

    setupAuthorized();
    const nullableProjection = sourceProjection();
    const nullableRpc = vi.fn().mockResolvedValue({
      data: pageData({
        products: [
          {
            ...pageData().products[0],
            product: {
              ...nullableProjection,
              product: { ...nullableProjection.product, weightUnit: null },
            },
          },
        ],
      }),
      error: null,
    });
    mocks.authenticate.mockResolvedValueOnce({
      user: { id: USER_ID },
      supabase: { rpc: nullableRpc, from: vi.fn() },
      error: null,
    });
    const absentFact = await POST(makeRequest(requestBody()));
    expect(absentFact.status).toBe(200);
    expect((await absentFact.json()).products[0].blockers).toContain(
      'source.product.weight.unit:content_invalid'
    );
  });

  it('rejects an integration object that does not match the requested active integration identity', async () => {
    const { rpc, client } = setupAuthorized();
    mocks.forIntegration.mockResolvedValueOnce({
      ...client,
      integrationId: '00000000-0000-4000-8000-000000000008',
    });
    expect((await POST(makeRequest(requestBody()))).status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('calls one bounded page RPC and rejects wrong-page or stale source evidence without fallback', async () => {
    const { rpc } = setupAuthorized();
    rpc.mockResolvedValueOnce({
      data: pageData({ page: 2 }),
      error: null,
    });
    const wrongPage = await POST(makeRequest(requestBody()));
    expect(wrongPage.status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'get_jumia_product_export_selection_page_for_merchant',
      {
        p_selection_id: SELECTION_ID,
        p_merchant_id: MERCHANT_ID,
        p_page: 1,
        p_limit: 50,
      }
    );

    const { rpc: staleRpc } = setupAuthorized();
    staleRpc.mockResolvedValueOnce({
      data: pageData({
        products: [
          {
            ...pageData().products[0],
            currentSourceVersion: 'b'.repeat(64),
          },
        ],
      }),
      error: null,
    });
    expect((await POST(makeRequest(requestBody()))).status).toBe(409);
    expect(staleRpc).toHaveBeenCalledTimes(1);
  });

  it('returns per-product results in selected-product order independent of mapping order', async () => {
    const { rpc } = setupAuthorized();
    const body = requestBody();
    const secondProjection = sourceProjection();
    secondProjection.product.id = SECOND_PRODUCT_ID;
    secondProjection.product.sku = 'SWITCH-OLED-SECOND';
    body.products.push({
      productId: SECOND_PRODUCT_ID,
      sourceVersion: 'b'.repeat(64),
    });
    body.mappings.push({ ...body.mappings[0], productId: SECOND_PRODUCT_ID });
    body.mappings.reverse();
    rpc.mockResolvedValueOnce({
      data: pageData({
        total: 2,
        products: [
          pageData().products[0],
          {
            ...pageData().products[0],
            id: SECOND_PRODUCT_ID,
            ordinal: 2,
            capturedSourceVersion: 'b'.repeat(64),
            currentSourceVersion: 'b'.repeat(64),
            product: secondProjection,
          },
        ],
      }),
      error: null,
    });

    const response = await POST(makeRequest(body));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.scope.productIds).toEqual([PRODUCT_ID, SECOND_PRODUCT_ID]);
    expect(
      result.products.map((product: { productId: string }) => product.productId)
    ).toEqual([PRODUCT_ID, SECOND_PRODUCT_ID]);
  });

  it('returns a credential-free blocked subset preview and never creates provider or database writes', async () => {
    const { rpc, supabase, client } = setupAuthorized();
    const response = await POST(makeRequest(requestBody()));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      scope: {
        selectionId: SELECTION_ID,
        sourceCategoryId: CATEGORY_ID,
        sourcePage: { page: 1, limit: 50 },
        productIds: [PRODUCT_ID],
      },
      digest: expect.stringMatching(/^jumia-preflight-v1:[0-9a-f]{64}$/),
      products: [
        {
          productId: PRODUCT_ID,
          sourceVersion: 'a'.repeat(64),
          locallyValid: false,
          recordCount: 0,
          blockers: expect.arrayContaining([
            'evidence.globalPrice:global_price_unproven',
            'evidence.providerClassification:classification_unproven',
            `evidence.images.${IMAGE_ID}:image_evidence_incomplete`,
          ]),
        },
      ],
      canSubmit: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /access.?token|refresh.?token|secret/i
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
    expect(client.getShops).toHaveBeenCalledTimes(1);
    expect(mocks.getAllCategories).toHaveBeenCalledTimes(1);
    expect(mocks.getAllBrands).toHaveBeenCalledTimes(1);
    expect(mocks.getAttributeSet).toHaveBeenCalledWith(
      client,
      ATTRIBUTE_SET_ID
    );
  });

  it('returns a safe error when digest serialization fails', async () => {
    setupAuthorized();
    mocks.digest.mockImplementationOnce(() => {
      throw new TypeError('unsafe digest input');
    });

    const response = await POST(makeRequest(requestBody()));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to build safe preflight response',
    });
  });

  it('rejects unavailable current category, brand, or attribute metadata safely', async () => {
    setupAuthorized();
    mocks.getAllCategories.mockRejectedValueOnce(
      new Error('private provider detail')
    );
    const unavailable = await POST(makeRequest(requestBody()));
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({
      error: 'Jumia preflight metadata unavailable',
    });

    setupAuthorized();
    mocks.getAllBrands.mockResolvedValueOnce([]);
    const missingBrand = await POST(makeRequest(requestBody()));
    expect(missingBrand.status).toBe(409);
  });
});
