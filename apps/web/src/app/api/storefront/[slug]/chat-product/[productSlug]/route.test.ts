import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  product: vi.fn(),
  map: vi.fn(),
}));
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolve,
}));
vi.mock('@/lib/cached-data', () => ({
  getCachedProductWithDetails: mocks.product,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock(
  '@/app/(storefront)/[slug]/(catalog)/(pdp)/products/[productSlug]/detailed-product-mapper',
  () => ({ mapDetailedCachedProductToProduct: mocks.map })
);

import { chatProductResponseSchema } from '@/schemas/chat-product-response';
import { GET } from './route';

const req = () =>
  new NextRequest(
    'https://shop.example/api/storefront/store/chat-product/phone'
  );
const params = (slug = 'store', productSlug = 'phone') => ({
  params: Promise.resolve({ slug, productSlug }),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    success: true,
    merchant: { id: 'trusted-merchant', payout_currency: 'NGN' },
  });
  mocks.product.mockResolvedValue({ id: 'p' });
  mocks.map.mockReturnValue({
    id: 'p',
    name: 'Phone',
    status: 'active',
    price: 100,
    image: '',
    imageLarge: '',
    imageHint: '',
    brand: '',
    gtin: '',
    mpn: '',
    stock: 1,
    manage_stock: true,
    has_variants: true,
    variants: [
      {
        id: 'v',
        product_id: 'p',
        merchant_id: 'trusted-merchant',
        attributes: { storage: '128GB' },
        price_override: 100,
        stock_quantity: 1,
        cost_price: 42,
        sku: 'secret-sku',
      },
    ],
  });
});
describe('public chat product detail', () => {
  it('resolves the trusted merchant and excludes non-public variant data', async () => {
    const response = await GET(req(), params());
    expect(response.status).toBe(200);
    expect(mocks.product).toHaveBeenCalledWith('trusted-merchant', 'phone');
    const body = await response.json();
    expect(chatProductResponseSchema.safeParse(body).success).toBe(true);
    expect(body.product.variants[0]).toMatchObject({
      id: 'v',
      price_override: 100,
      stock_quantity: 1,
    });
    expect(body.product.variants[0]).not.toHaveProperty('cost_price');
    expect(body.product.variants[0]).not.toHaveProperty('sku');
    expect(body.product.currency.code).toBe('NGN');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });
  it('returns the resolved merchant currency, never a request supplied value', async () => {
    mocks.resolve.mockResolvedValue({
      success: true,
      merchant: { id: 'trusted-merchant', payout_currency: 'GHS' },
    });
    const response = await GET(
      new NextRequest(
        'https://shop.example/api/storefront/store/chat-product/phone?currency=NGN'
      ),
      params()
    );
    const body = await response.json();
    expect(body.product.currency).toMatchObject({ code: 'GHS', symbol: 'GH₵' });
    expect(chatProductResponseSchema.safeParse(body).success).toBe(true);
  });
  it('fails closed when payout currency is unsupported even if country currency is known', async () => {
    mocks.resolve.mockResolvedValue({
      success: true,
      merchant: {
        id: 'trusted-merchant',
        payout_currency: 'ZZZ',
        country: 'US',
      },
    });
    const response = await GET(req(), params());
    expect(response.status).toBe(503);
    expect(mocks.product).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('uses the checkout NGN fallback when payout currency is blank', async () => {
    mocks.resolve.mockResolvedValue({
      success: true,
      merchant: {
        id: 'trusted-merchant',
        payout_currency: '',
        country: 'US',
      },
    });
    const response = await GET(req(), params());
    const body = await response.json();
    expect(body.product.currency.code).toBe('NGN');
    expect(chatProductResponseSchema.safeParse(body).success).toBe(true);
  });
  it('rejects an invalid product slug before looking up a merchant', async () => {
    const response = await GET(req(), params('store', '../escape'));
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('accepts generated product slugs containing underscores', async () => {
    const response = await GET(req(), params('store', 'iphone_13'));
    expect(response.status).toBe(200);
    expect(mocks.product).toHaveBeenCalledWith('trusted-merchant', 'iphone_13');
  });
  it('fails closed when projected product data exceeds response bounds', async () => {
    mocks.map.mockReturnValue({
      id: 'p',
      name: 'x'.repeat(2049),
      status: 'active',
      price: 100,
      image: '',
      imageLarge: '',
      imageHint: '',
      brand: '',
      gtin: '',
      mpn: '',
      stock: 1,
      manage_stock: true,
      has_variants: true,
      variants: Array.from({ length: 129 }, (_, index) => ({
        id: `v${index}`,
        product_id: 'p',
        merchant_id: 'trusted-merchant',
        attributes: {},
        stock_quantity: 1,
      })),
      offers: [],
    });
    const response = await GET(req(), params());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Product unavailable' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('returns 404 when a tenant-bound product is missing', async () => {
    mocks.product.mockResolvedValue(null);
    expect((await GET(req(), params())).status).toBe(404);
  });
  it('returns 404 and no-store when the mapped product is not active', async () => {
    mocks.map.mockReturnValueOnce({ status: 'draft' });
    const response = await GET(req(), params());
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('returns a generic no-store 503 when the product lookup throws', async () => {
    mocks.product.mockRejectedValue(new Error('database details'));
    const response = await GET(req(), params());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Product unavailable' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('returns no-store when the merchant cannot be resolved', async () => {
    mocks.resolve.mockResolvedValue({
      success: false,
      status: 404,
      error: 'Store not found',
    });
    const response = await GET(req(), params());
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('fails closed when a resolved merchant has no trusted currency source', async () => {
    mocks.resolve.mockResolvedValue({
      success: true,
      merchant: { id: 'trusted-merchant', payout_currency: 'ZZZ' },
    });
    const response = await GET(req(), params());
    expect(response.status).toBe(503);
    expect(mocks.product).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
