import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  getCachedSantaProductList: vi.fn(),
  resolveAgenticChatTenant: vi.fn(),
}));
vi.mock('@/ai/santa-data', () => ({
  getCachedSantaProductList: mocks.getCachedSantaProductList,
}));
vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: mocks.resolveAgenticChatTenant,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/product-stock', () => ({ getEffectiveStock: () => 3 }));
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeForLog: (value: string) => value,
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: mocks.createPublicClient,
}));

import { GET, POST } from './route';

const tenant = {
  agenticCheckoutEnabled: true,
  businessName: 'Demo Store',
  currencyCode: 'NGN',
  merchantId: 'merchant-1',
  merchantSlug: 'demo-store',
  priceNegotiationEnabled: true,
};
function request(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function productQuery(product: unknown) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: product, error: null }),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe('Santa product lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAgenticChatTenant.mockResolvedValue(tenant);
  });
  it('rejects a blank GET product name before tenant or catalog lookup', async () => {
    const response = await GET(
      request('https://usebaci.com/api/chat/santa/product?name=%20%20')
    );
    expect(response.status).toBe(400);
    expect(mocks.resolveAgenticChatTenant).not.toHaveBeenCalled();
  });
  it('fails closed when the configured tenant cannot be resolved', async () => {
    mocks.resolveAgenticChatTenant.mockResolvedValueOnce(null);
    const response = await POST(
      request('https://usebaci.com/api/chat/santa/product', { name: 'Phone' })
    );
    expect(response.status).toBe(503);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });
  it('uses the public catalog client and confirms the resolved merchant in its response', async () => {
    mocks.getCachedSantaProductList.mockResolvedValueOnce([
      { name: 'Phone', price: 100_000, max_discount_percentage: 2 },
    ]);
    const query = productQuery({
      brand: 'Apple',
      description: null,
      has_variants: false,
      id: 'product-1',
      images: [],
      manage_stock: false,
      merchant_id: 'merchant-1',
      name: 'Phone',
      price: 100_000,
      sku: null,
      slug: 'phone',
      status: 'active',
      stock: 0,
      stock_quantity: 0,
    });
    mocks.createPublicClient.mockReturnValue({ from: vi.fn(() => query) });
    const response = await POST(
      request('https://usebaci.com/api/chat/santa/product', { name: 'Phone' })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-santa-merchant-slug')).toBe(
      'demo-store'
    );
    expect(mocks.createPublicClient).toHaveBeenCalledWith({
      clientInfo: 'baci-santa-product',
    });
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    await expect(response.json()).resolves.toMatchObject({
      product: {
        id: 'product-1',
        merchant_id: 'merchant-1',
        max_discount_percentage: 2,
      },
    });
  });
  it('refuses variant-bearing products that need an explicit SKU choice', async () => {
    mocks.getCachedSantaProductList.mockResolvedValueOnce([
      { name: 'Phone', price: 100_000, max_discount_percentage: 2 },
    ]);
    const query = productQuery({
      brand: 'Apple',
      description: null,
      has_variants: true,
      id: 'product-1',
      images: [],
      manage_stock: false,
      merchant_id: 'merchant-1',
      name: 'Phone',
      price: 100_000,
      sku: null,
      slug: 'phone',
      status: 'active',
      stock: 0,
      stock_quantity: 0,
    });
    mocks.createPublicClient.mockReturnValue({ from: vi.fn(() => query) });
    const response = await POST(
      request('https://usebaci.com/api/chat/santa/product', { name: 'Phone' })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-santa-merchant-slug')).toBe(
      'demo-store'
    );
    await expect(response.json()).resolves.toEqual({ product: null });
  });
});
