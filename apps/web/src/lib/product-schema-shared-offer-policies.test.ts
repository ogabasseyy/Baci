import type { MerchantReturnPolicy, OfferShippingDetails } from 'schema-dts';
import { describe, expect, it } from 'vitest';
import { buildSharedOfferPolicies } from './product-schema-shared-offer-policies';

const shipping: OfferShippingDetails = {
  '@type': 'OfferShippingDetails',
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'NG' },
};
const returns: MerchantReturnPolicy = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'NG',
  merchantReturnDays: 7,
};

describe('buildSharedOfferPolicies', () => {
  it('defines both policies with page-scoped ids on the first variant', () => {
    const policiesFor = buildSharedOfferPolicies(
      new URL('https://shop.example/phones/x?variantId=a#top'),
      shipping,
      returns
    );

    expect(policiesFor(0)).toEqual({
      shippingDetails: {
        '@id': 'https://shop.example/phones/x#shipping-policy',
        ...shipping,
      },
      hasMerchantReturnPolicy: {
        '@id': 'https://shop.example/phones/x#return-policy',
        ...returns,
      },
    });
  });

  it('references the first variant policies from later variants', () => {
    const policiesFor = buildSharedOfferPolicies(
      new URL('https://shop.example/phones/x'),
      shipping,
      returns
    );

    expect(policiesFor(3)).toEqual({
      shippingDetails: {
        '@id': 'https://shop.example/phones/x#shipping-policy',
      },
      hasMerchantReturnPolicy: {
        '@id': 'https://shop.example/phones/x#return-policy',
      },
    });
  });

  it('falls back to fragment ids when the product URL is unknown', () => {
    const policiesFor = buildSharedOfferPolicies(undefined, shipping, returns);

    expect(policiesFor(1).shippingDetails).toEqual({
      '@id': '#shipping-policy',
    });
    expect(policiesFor(0).hasMerchantReturnPolicy).toMatchObject({
      '@id': '#return-policy',
      merchantReturnDays: 7,
    });
  });
});
