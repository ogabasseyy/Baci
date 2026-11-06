import { describe, expect, it } from 'vitest';
import { normalizeCachedStorefrontPdpCore } from './storefront-pdp-core-normalizer';

describe('normalizeCachedStorefrontPdpCore', () => {
  it('rejects snapshots without valid required product fields', () => {
    const validProduct = { id: 'product-1', name: 'Phone', price: 100 };

    expect(
      normalizeCachedStorefrontPdpCore({ ...validProduct, id: null })
    ).toBe(null);
    expect(
      normalizeCachedStorefrontPdpCore({ ...validProduct, name: undefined })
    ).toBe(null);
    expect(
      normalizeCachedStorefrontPdpCore({ ...validProduct, price: Number.NaN })
    ).toBe(null);
    expect(
      normalizeCachedStorefrontPdpCore({ ...validProduct, price: '100' })
    ).toBe(null);
  });

  it('falls back to product id for an empty slug and normalizes images', () => {
    const normalized = normalizeCachedStorefrontPdpCore({
      id: 'product-1',
      name: 'Phone',
      price: 100,
      slug: '',
      images: [
        'https://cdn.example/phone.png',
        { url: 'https://cdn.example/back.png', alt: 'Back', order: 2 },
        { url: 'https://cdn.example/front.png', alt: 10, order: 'first' },
        { url: 10 },
        null,
      ],
    });

    expect(normalized).toMatchObject({
      id: 'product-1',
      name: 'Phone',
      slug: 'product-1',
      price: 100,
      images: [
        'https://cdn.example/phone.png',
        {
          url: 'https://cdn.example/back.png',
          alt: 'Back',
          order: 2,
        },
        { url: 'https://cdn.example/front.png' },
      ],
    });
  });

  it('shares normalized offers and preserves public variants', () => {
    const offers = [
      {
        id: 'offer-1',
        condition: 'new',
        price: 100,
        status: 'active',
      },
    ];
    const variants = [
      {
        id: 'variant-1',
        product_id: 'product-1',
        attributes: { storage: '128GB' },
        stock_quantity: 2,
      },
    ];

    const normalized = normalizeCachedStorefrontPdpCore({
      id: 'product-1',
      name: 'Phone',
      price: 100,
      product_offers: offers,
      product_variants: variants,
    });

    expect(normalized?.offers).toEqual(offers);
    expect(normalized?.product_offers).toEqual(offers);
    expect(normalized?.product_variants).toEqual(variants);
  });
});
