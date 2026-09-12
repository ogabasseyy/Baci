import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  checkCsrfProtection: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  getProductEmbeddingText: vi.fn(),
  getUser: vi.fn(),
  scheduleNewProductBlogPurgeAfterResponse: vi.fn(),
  scheduleNewProductCaches: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => new Map()),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
}));

vi.mock('@/lib/embeddings', () => ({
  getProductEmbeddingText: mocks.getProductEmbeddingText,
}));

vi.mock('@/lib/countries', () => ({
  getCountryByCode: () => ({ currency: 'NGN' }),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (value: string) => value,
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  sanitizeSchemaMarkup: (value: unknown) => value,
}));

vi.mock('@/lib/seo-utils', () => ({
  generateMetaDescription: () => 'Meta description',
  generateProductSchema: () => ({ '@type': 'Product' }),
  generateProductSlug: () => 'test-product',
  generateSlug: () => 'test-product',
}));

vi.mock('@/lib/product-variant-model', () => ({
  getSkuMatrixValidationError: () => null,
  inferProductVariantModel: () => 'simple',
}));

vi.mock('./build-product-images-input', () => ({
  buildProductImagesInput: () => [],
}));

vi.mock('./schedule-new-product-blog-purge-after-response', () => ({
  scheduleNewProductBlogPurgeAfterResponse:
    mocks.scheduleNewProductBlogPurgeAfterResponse,
}));

vi.mock('./schedule-new-product-caches', () => ({
  scheduleNewProductCaches: mocks.scheduleNewProductCaches,
}));

vi.mock('@/schemas/products', () => ({
  createProductSchema: {
    safeParse: (body: Record<string, unknown>) => ({
      success: true,
      data: body,
    }),
  },
  formatZodErrors: vi.fn(),
}));

import { createProduct } from './create-product';

function setupAuthenticatedProduct(
  invoke: ReturnType<typeof vi.fn>,
  status?: 'active' | 'draft'
) {
  const merchantQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  merchantQuery.select.mockReturnValue(merchantQuery);
  merchantQuery.eq.mockReturnValue(merchantQuery);
  merchantQuery.single.mockResolvedValue({ data: { country: 'NG' } });

  const existingProductQuery = {
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    select: vi.fn(),
  };
  existingProductQuery.select.mockReturnValue(existingProductQuery);
  existingProductQuery.eq.mockReturnValue(existingProductQuery);
  existingProductQuery.maybeSingle.mockResolvedValue({ data: null });

  const insertedProductQuery = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  insertedProductQuery.insert.mockReturnValue(insertedProductQuery);
  insertedProductQuery.select.mockReturnValue(insertedProductQuery);
  insertedProductQuery.single.mockResolvedValue({
    data: { id: 'product-1' },
  });

  const from = vi
    .fn()
    .mockReturnValueOnce(merchantQuery)
    .mockReturnValueOnce(existingProductQuery)
    .mockReturnValueOnce(insertedProductQuery);
  mocks.createClient.mockReturnValue({
    auth: { getUser: mocks.getUser },
    from,
    functions: { invoke },
  });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'merchant-1' } },
    error: null,
  });
  mocks.checkCsrfProtection.mockResolvedValue({ valid: true, response: null });
  mocks.getMerchantForApiRequest.mockResolvedValue({
    businessName: 'Test Store',
    merchantId: 'merchant-1',
    merchantSlug: 'test-store',
  });
  mocks.getProductEmbeddingText.mockReturnValue('embedding text');

  return new NextRequest('http://localhost:3000/api/products', {
    body: JSON.stringify({
      name: 'Test product',
      price: 1000,
      ...(status ? { status } : {}),
    }),
    method: 'POST',
  });
}

describe('createProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });

  it('returns Unauthorized before checking CSRF or parsing an unauthenticated malformed request', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await createProduct(
      new NextRequest('http://localhost:3000/api/products', {
        method: 'POST',
        body: '{not valid JSON',
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns the CSRF rejection after authenticating and before parsing product input', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'merchant-1' } },
      error: null,
    });
    const csrfResponse = new Response(
      JSON.stringify({ error: 'CSRF validation failed' }),
      { status: 403 }
    );
    mocks.checkCsrfProtection.mockResolvedValue({
      valid: false,
      response: csrfResponse,
    });

    const response = await createProduct(
      new NextRequest('http://localhost:3000/api/products', {
        method: 'POST',
        body: '{not valid JSON',
      })
    );

    expect(response).toBe(csrfResponse);
    expect(response.status).toBe(403);
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.checkCsrfProtection.mock.invocationCallOrder[0]
    );
  });

  it('generates the product embedding through the authenticated request client', async () => {
    const invoke = vi.fn().mockResolvedValue({ error: null });
    const response = await createProduct(setupAuthenticatedProduct(invoke));

    expect(response.status).toBe(201);
    expect(invoke).toHaveBeenCalledWith('generate-embedding', {
      body: { id: 'product-1', text: 'embedding text', type: 'product' },
      signal: expect.any(AbortSignal),
    });
  });

  it('queues a blog purge for an active product after creation', async () => {
    const response = await createProduct(
      setupAuthenticatedProduct(
        vi.fn().mockResolvedValue({ error: null }),
        'active'
      )
    );

    expect(response.status).toBe(201);
    expect(mocks.scheduleNewProductBlogPurgeAfterResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        category: undefined,
        merchantId: 'merchant-1',
        merchantSlug: 'test-store',
        name: 'Test product',
        productId: 'product-1',
        slug: 'test-product',
        status: 'active',
      })
    );
  });

  it('does not queue a blog purge for the default draft status', async () => {
    const response = await createProduct(
      setupAuthenticatedProduct(vi.fn().mockResolvedValue({ error: null }))
    );

    expect(response.status).toBe(201);
    expect(
      mocks.scheduleNewProductBlogPurgeAfterResponse
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      'returns an error',
      vi.fn().mockResolvedValue({ error: new Error('edge') }),
    ],
    ['rejects', vi.fn().mockRejectedValue(new Error('network'))],
  ])('keeps product creation successful when embedding generation %s', async (_case, invoke) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await createProduct(setupAuthenticatedProduct(invoke));

    expect(response.status).toBe(201);
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to generate product embedding:',
        expect.any(Error)
      )
    );
    errorSpy.mockRestore();
  });
});
