import { describe, expect, it } from 'vitest';
import { applyCriticalRouteOfferToCartProduct } from '@/components/storefront/ogabassey/pdp/critical-commerce-route-offer';
import type { Product } from '@/lib/products';
import { buildLcpRouteProductProjection } from './lcp-route-product-projection';

describe('buildLcpRouteProductProjection', () => {
  it('normalizes active condition offers and excludes the main condition', () => {
    const projection = buildLcpRouteProductProjection({
      condition: 'new',
      product_offers: [
        {
          condition: 'open_box',
          id: 'open-box-offer',
          images: ['https://cdn.example/open-box.avif'],
          price: '1,200,000',
          status: 'active',
          stock_quantity: '2',
        },
        {
          condition: 'new',
          id: 'main-condition-offer',
          price: 1_300_000,
          status: 'active',
        },
        {
          condition: 'used',
          id: 'inactive-offer',
          price: 900_000,
          status: 'inactive',
        },
        {
          condition: 'used',
          id: 'invalid-price-offer',
          price: 'not-a-price',
          status: 'active',
        },
      ],
      product_variants: [{ id: 'variant-1' }],
    });

    expect(projection).toEqual({
      condition: 'new',
      hasVariantMatrix: true,
      offers: [
        {
          condition: 'open_box',
          id: 'open-box-offer',
          images: ['https://cdn.example/open-box.avif'],
          price: 1_200_000,
          stock_quantity: 2,
        },
      ],
    });
  });

  it('preserves the offer-specific allocation for the strict critical buy box', () => {
    const projection = buildLcpRouteProductProjection({
      condition: 'new',
      product_offers: [
        {
          id: 'used-offer',
          condition: 'used',
          status: 'active',
          price: 100,
          stock_quantity: 2,
          allocatable_stock: 2,
        },
      ],
    });
    const product = {
      inventory_tracking_policy: 'serialized_strict',
      stock: 0,
      stock_quantity: 0,
    } as Product;
    const offer = projection.offers?.[0];
    if (!offer) throw new Error('Expected projected offer');
    expect(
      applyCriticalRouteOfferToCartProduct(product, offer, product).stock
    ).toBe(2);
  });

  it.each([
    { input: null, expected: null },
    { input: 0, expected: 0 },
    { input: '2', expected: 2 },
    { input: 'invalid', expected: 0 },
  ])('preserves bounded, unbounded and invalid allocation values', ({
    input,
    expected,
  }) => {
    const projection = buildLcpRouteProductProjection({
      condition: 'new',
      product_offers: [
        {
          id: 'offer',
          condition: 'used',
          status: 'active',
          price: 100,
          allocatable_stock: input,
        },
      ],
    });
    expect(projection.offers?.[0]?.allocatable_stock).toBe(expected);
  });

  it('keeps an absent offer collection absent and reports no variant matrix', () => {
    expect(
      buildLcpRouteProductProjection({
        condition: null,
        product_offers: undefined,
        product_variants: [],
      })
    ).toEqual({
      condition: undefined,
      hasVariantMatrix: false,
      offers: undefined,
    });
  });
});
