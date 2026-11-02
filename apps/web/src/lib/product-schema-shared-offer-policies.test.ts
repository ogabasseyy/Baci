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
      'x',
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
      'x',
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

  it('scopes fallback ids to the product group when the URL is unknown', () => {
    const phone = buildSharedOfferPolicies(
      undefined,
      'phone x',
      shipping,
      returns
    );
    const laptop = buildSharedOfferPolicies(
      undefined,
      'laptop',
      shipping,
      returns
    );

    expect(phone(1).shippingDetails).toEqual({
      '@id': '#phone%20x-shipping-policy',
    });
    expect(phone(0).hasMerchantReturnPolicy).toMatchObject({
      '@id': '#phone%20x-return-policy',
      merchantReturnDays: 7,
    });
    expect(laptop(1).shippingDetails).toEqual({
      '@id': '#laptop-shipping-policy',
    });
  });

  it('replaces an incoming @id with the page-scoped id so references resolve', () => {
    const policiesFor = buildSharedOfferPolicies(
      new URL('https://shop.example/phones/x'),
      'x',
      {
        ...shipping,
        '@id': 'https://elsewhere.example/#ship',
      } as OfferShippingDetails,
      returns
    );

    expect(policiesFor(0).shippingDetails).toMatchObject({
      '@id': 'https://shop.example/phones/x#shipping-policy',
    });
  });
});
