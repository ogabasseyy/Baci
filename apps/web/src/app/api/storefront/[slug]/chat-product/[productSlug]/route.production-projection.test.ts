import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  uncachedProduct: vi.fn(),
}));

vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolve,
}));
vi.mock('@/lib/uncached-storefront-product', () => ({
  getUncachedProductWithDetails: mocks.uncachedProduct,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { normalizeCachedStorefrontPdpCore } from '@/lib/storefront-pdp-core-normalizer';
import { chatProductResponseSchema } from '@/schemas/chat-product-response';
import { GET } from './route';

describe('chat product production projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({
      success: true,
      merchant: { id: 'trusted-merchant', payout_currency: 'NGN' },
    });
  });

  it('maps nullable snapshot fields to the bounded public response shape', async () => {
    const product = normalizeCachedStorefrontPdpCore({
      id: 'product-1',
      merchant_id: 'trusted-merchant',
      name: 'Phone',
      description: null,
      status: 'active',
      price: 100,
      compare_at_price: null,
      manage_stock: null,
      stock: null,
      stock_quantity: null,
      variant_model: null,
      product_variants: [
        {
          id: 'variant-1',
          product_id: 'product-1',
          attributes: null,
          condition: null,
          price_override: null,
          stock_quantity: null,
          primary_image: null,
        },
      ],
      product_offers: [
        {
          id: 'offer-1',
          condition: 'new',
          price: 100,
          stock_quantity: null,
          status: 'active',
        },
      ],
    });
    expect(product).not.toBeNull();
    mocks.uncachedProduct.mockResolvedValue(product);

    const response = await GET(
      new NextRequest(
        'https://shop.example/api/storefront/store/chat-product/phone'
      ),
      { params: Promise.resolve({ slug: 'store', productSlug: 'phone' }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(chatProductResponseSchema.safeParse(body).success).toBe(true);
    expect(body.product.stock_quantity).toBe(0);
    expect(body.product.variant_model).toBe('legacy');
    expect(body.product.variants[0]).toMatchObject({
      attributes: {},
      stock_quantity: 0,
    });
    expect(body.product.variants[0]).not.toHaveProperty('condition');
    expect(body.product.variants[0]).not.toHaveProperty('primary_image');
    expect(body.product.offers[0]).toMatchObject({
      price: 100,
      stock_quantity: 0,
    });
  });
});
