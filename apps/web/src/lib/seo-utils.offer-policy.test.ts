import { describe, expect, it } from 'vitest';
import { generateOrganizationSchema, generateProductSchema } from './seo-utils';
import { makeSeoProduct as makeProduct } from './seo-utils-product-schema-test-helper';
import type { MerchantTrustProfile } from './storefront-trust/merchant-trust-profile-types';

function makeTrustProfile(
  overrides: Partial<MerchantTrustProfile> = {}
): MerchantTrustProfile {
  return {
    socialLinks: {},
    derivedLinks: {},
    ...overrides,
  };
}

describe('generateProductSchema - offer policy schemas', () => {
  it('omits unknown optional shipping and return objects on variant offers when trust profile is missing', () => {
    const product = makeProduct({
      variants: [
        {
          id: 'v1',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { storage: '128GB' },
          stock_quantity: 5,
        },
      ],
    });

    const schema = generateProductSchema(product, 'TestStore', 'NGN', 'NG');
    const variants = schema.hasVariant as Record<string, unknown>[];
    const offer = variants[0].offers as Record<string, unknown>;

    expect(offer).not.toHaveProperty('priceValidUntil');
    expect(offer).not.toHaveProperty('shippingDetails');
    expect(offer).not.toHaveProperty('hasMerchantReturnPolicy');
  });

  it('omits unknown optional shipping and return objects on single-product offers when trust profile is missing', () => {
    const product = makeProduct({
      stock_quantity: 5,
    });

    const schema = generateProductSchema(product, 'TestStore', 'NGN', 'NG');
    const offer = schema.offers as Record<string, unknown>;

    expect(offer).not.toHaveProperty('priceValidUntil');
    expect(offer).not.toHaveProperty('shippingDetails');
    expect(offer).not.toHaveProperty('hasMerchantReturnPolicy');
  });

  it('defines shared offer policies once and references them from later variants', () => {
    const product = makeProduct({
      variants: [1, 2, 3].map((n) => ({
        id: `v${n}`,
        product_id: 'test-123',
        merchant_id: 'm1',
        attributes: { storage: `${n * 128}GB` },
        stock_quantity: 5,
      })),
    });

    const schema = generateProductSchema(
      product,
      'TestStore',
      'NGN',
      'NG',
      undefined,
      makeTrustProfile({
        returnPolicy: {
          summary: 'Returns accepted within 14 days.',
          windowDays: 14,
          returnMethod: 'mail',
          returnFees: 'customer_pays',
          localRoute: '/returns',
        },
        shippingPolicy: {
          summary: 'Ships across Nigeria.',
          regions: ['NG'],
          handlingDaysMin: 2,
          handlingDaysMax: 4,
          transitDaysMin: 6,
          transitDaysMax: 8,
          shippingFeeType: 'free',
          localRoute: '/shipping',
        },
      }),
      { productUrl: 'https://shop.example/phones/test-product' }
    );
    const offers = (schema.hasVariant as Record<string, unknown>[]).map(
      (variant) => variant.offers as Record<string, unknown>
    );

    expect(offers[0]?.shippingDetails).toMatchObject({
      '@id': 'https://shop.example/phones/test-product#shipping-policy',
      '@type': 'OfferShippingDetails',
    });
    expect(offers[0]?.hasMerchantReturnPolicy).toMatchObject({
      '@id': 'https://shop.example/phones/test-product#return-policy',
      '@type': 'MerchantReturnPolicy',
    });
    for (const offer of offers.slice(1)) {
      expect(offer.shippingDetails).toEqual({
        '@id': 'https://shop.example/phones/test-product#shipping-policy',
      });
      expect(offer.hasMerchantReturnPolicy).toEqual({
        '@id': 'https://shop.example/phones/test-product#return-policy',
      });
    }
  });

  it('uses structured trust profile shipping and return settings instead of hardcoded defaults', () => {
    const schema = generateProductSchema(
      makeProduct({
        variants: [
          {
            id: 'v1',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { storage: '128GB' },
            stock_quantity: 5,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      makeTrustProfile({
        returnPolicy: {
          summary: 'Returns accepted within 14 days.',
          windowDays: 14,
          returnMethod: 'mail',
          returnFees: 'customer_pays',
          localRoute: '/returns',
        },
        shippingPolicy: {
          summary: 'Ships across Nigeria.',
          regions: ['NG'],
          handlingDaysMin: 2,
          handlingDaysMax: 4,
          transitDaysMin: 6,
          transitDaysMax: 8,
          shippingFeeType: 'free',
          localRoute: '/shipping',
        },
      })
    );

    const offer = (schema.hasVariant as Record<string, unknown>[])[0]
      .offers as Record<string, unknown>;
    const shipping = offer.shippingDetails as Record<string, unknown>;
    const returnPolicy = offer.hasMerchantReturnPolicy as Record<
      string,
      unknown
    >;
    const deliveryTime = shipping.deliveryTime as Record<string, unknown>;
    const handlingTime = deliveryTime.handlingTime as Record<string, unknown>;
    const transitTime = deliveryTime.transitTime as Record<string, unknown>;

    expect(shipping.shippingRate).toEqual({
      '@type': 'MonetaryAmount',
      value: 0,
      currency: 'NGN',
    });
    expect(handlingTime.minValue).toBe(2);
    expect(handlingTime.maxValue).toBe(4);
    expect(transitTime.minValue).toBe(6);
    expect(transitTime.maxValue).toBe(8);
    expect(returnPolicy.merchantReturnDays).toBe(14);
    expect(returnPolicy.returnMethod).toBe('https://schema.org/ReturnByMail');
    expect(returnPolicy.returnFees).toBe(
      'https://schema.org/ReturnShippingFees'
    );
  });

  it('populates shipping and return policies on single-product offers when trust profile is present', () => {
    const schema = generateProductSchema(
      makeProduct({
        stock_quantity: 5,
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      makeTrustProfile({
        returnPolicy: {
          summary: 'Returns accepted within 14 days.',
          windowDays: 14,
          returnMethod: 'carrier_dropoff',
          returnFees: 'free',
          localRoute: '/returns',
        },
        shippingPolicy: {
          summary: 'Ships across Nigeria.',
          regions: ['NG'],
          handlingDaysMin: 1,
          handlingDaysMax: 3,
          transitDaysMin: 3,
          transitDaysMax: 5,
          shippingFeeType: 'free',
          localRoute: '/shipping',
        },
      })
    );

    const offer = schema.offers as Record<string, unknown>;
    const shipping = offer.shippingDetails as Record<string, unknown>;
    const returnPolicy = offer.hasMerchantReturnPolicy as Record<
      string,
      unknown
    >;

    expect(shipping).toMatchObject({
      '@type': 'OfferShippingDetails',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: 0,
        currency: 'NGN',
      },
    });
    expect(returnPolicy).toMatchObject({
      '@type': 'MerchantReturnPolicy',
      merchantReturnDays: 14,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/FreeReturn',
    });
  });
});

describe('generateOrganizationSchema - return policy', () => {
  it('adds return policy from trust profile to organization schema', () => {
    const schema = generateOrganizationSchema({
      name: 'Test Store',
      url: 'https://test.example',
      country: 'NG',
      trustProfile: makeTrustProfile({
        returnPolicy: {
          summary: 'Returns accepted for 14 days.',
          windowDays: 14,
          returnMethod: 'carrier_dropoff',
          returnFees: 'free',
          localRoute: '/returns',
        },
      }),
    });

    expect(schema.hasMerchantReturnPolicy).toMatchObject({
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'NG',
      returnPolicyCountry: 'NG',
      merchantReturnDays: 14,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/FreeReturn',
    });
  });
});
