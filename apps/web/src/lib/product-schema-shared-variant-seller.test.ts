import { describe, expect, it } from 'vitest';
import { buildSharedVariantOfferSeller } from './product-schema-shared-variant-seller';

describe('buildSharedVariantOfferSeller', () => {
  it('defines seller and acceptedPaymentMethod once on the first variant and references by @id later', () => {
    const sellerFor = buildSharedVariantOfferSeller(
      new URL('https://shop.example/phones/x'),
      'x',
      3,
      {
        '@type': 'Organization',
        '@id': 'https://shop.example/#online-store',
        name: 'Shop Example',
      },
      ['https://schema.org/CreditCard', 'https://schema.org/COD']
    );

    expect(sellerFor(0)).toEqual({
      '@type': 'Organization',
      '@id': 'https://shop.example/#online-store',
      name: 'Shop Example',
      acceptedPaymentMethod: [
        'https://schema.org/CreditCard',
        'https://schema.org/COD',
      ],
    });
    expect(sellerFor(1)).toEqual({
      '@id': 'https://shop.example/#online-store',
    });
    expect(sellerFor(2)).toEqual({
      '@id': 'https://shop.example/#online-store',
    });
  });

  it('scopes fallback seller @id to the product URL or group id for multi-variant products', () => {
    const withUrl = buildSharedVariantOfferSeller(
      new URL('https://shop.example/phones/x?variantId=v1'),
      'x',
      2,
      { '@type': 'Organization', name: 'Shop Example' }
    );
    const withoutUrl = buildSharedVariantOfferSeller(undefined, 'phone x', 2, {
      '@type': 'Organization',
      name: 'Shop Example',
    });

    expect(withUrl(0)).toEqual({
      '@type': 'Organization',
      '@id': 'https://shop.example/phones/x#seller',
      name: 'Shop Example',
    });
    expect(withUrl(1)).toEqual({
      '@id': 'https://shop.example/phones/x#seller',
    });
    expect(withoutUrl(0)).toEqual({
      '@type': 'Organization',
      '@id': '#phone%20x-seller',
      name: 'Shop Example',
    });
    expect(withoutUrl(1)).toEqual({
      '@id': '#phone%20x-seller',
    });
  });

  it('preserves inline seller without inventing @id for single-variant products', () => {
    const singleVariant = buildSharedVariantOfferSeller(
      undefined,
      'x',
      1,
      { '@type': 'Organization', name: 'Shop Example' },
      ['https://schema.org/COD']
    );

    expect(singleVariant(0)).toEqual({
      '@type': 'Organization',
      name: 'Shop Example',
      acceptedPaymentMethod: ['https://schema.org/COD'],
    });
  });
});
