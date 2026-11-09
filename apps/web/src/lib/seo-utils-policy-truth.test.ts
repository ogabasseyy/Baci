import { describe, expect, it } from 'vitest';
import { generateOrganizationSchema, generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('product policy and variant truth', () => {
  it('does not invent nationwide free shipping or unknown return fees and methods', () => {
    const schema = generateProductSchema(
      makeSeoProduct(),
      'Ogabassey',
      'NGN',
      'NG',
      undefined,
      {
        socialLinks: {},
        derivedLinks: {},
        shippingPolicy: {
          localRoute: '/shipping',
          regions: ['Nigeria'],
          summary:
            'Free Lagos delivery where eligible; checkout quotes elsewhere',
        },
        returnPolicy: {
          localRoute: '/returns',
          windowDays: 14,
          summary: 'Defective items only, within fourteen days',
        },
      }
    );
    const offer = schema.offers as Record<string, unknown>;
    expect(offer).not.toHaveProperty('shippingDetails');
    expect(offer.hasMerchantReturnPolicy).toMatchObject({
      merchantReturnDays: 14,
    });
    expect(offer.hasMerchantReturnPolicy).not.toHaveProperty('returnFees');
    expect(offer.hasMerchantReturnPolicy).not.toHaveProperty('returnMethod');
  });

  it('omits entire optional objects when merchant shipping rates and returns are unknown', () => {
    const schema = generateProductSchema(makeSeoProduct(), 'Other merchant');
    const offer = schema.offers as Record<string, unknown>;
    expect(offer).not.toHaveProperty('shippingDetails');
    expect(offer).not.toHaveProperty('hasMerchantReturnPolicy');
  });

  it('does not turn configured zero days into an invalid finite-window return policy', () => {
    const schema = generateProductSchema(
      makeSeoProduct(),
      'Other merchant',
      'NGN',
      'NG',
      undefined,
      {
        socialLinks: {},
        derivedLinks: {},
        returnPolicy: { localRoute: '/returns', windowDays: 0 },
      }
    );
    const offer = schema.offers as Record<string, unknown>;
    expect(offer.hasMerchantReturnPolicy).toMatchObject({
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
    });
    expect(offer.hasMerchantReturnPolicy).not.toHaveProperty(
      'merchantReturnDays'
    );
  });

  it('omits organization return markup if a summary supplies no supported policy category', () => {
    const schema = generateOrganizationSchema({
      name: 'Other merchant',
      url: 'https://example.com',
      trustProfile: {
        socialLinks: {},
        derivedLinks: {},
        returnPolicy: { localRoute: '/returns', summary: 'Contact support' },
      },
    });
    expect(schema).not.toHaveProperty('hasMerchantReturnPolicy');
  });

  it('omits free shipping markup when delivery timing has not been confirmed', () => {
    const schema = generateProductSchema(
      makeSeoProduct(),
      'Other merchant',
      'NGN',
      'NG',
      undefined,
      {
        socialLinks: {},
        derivedLinks: {},
        shippingPolicy: {
          localRoute: '/shipping',
          regions: ['NG'],
          shippingFeeType: 'free',
        },
      }
    );
    expect(schema.offers).not.toHaveProperty('shippingDetails');
  });

  it('uses a variant primary image instead of the mixed family gallery', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        variants: [
          {
            id: 'white-512',
            product_id: 'test-123',
            merchant_id: 'merchant',
            attributes: { color: 'White', storage: '512GB' },
            stock_quantity: 1,
            primary_image: 'https://cdn.example.com/white.jpg',
          },
        ],
      }),
      'Ogabassey'
    );
    expect(schema.hasVariant?.[0]).toHaveProperty('image', [
      'https://cdn.example.com/white.jpg',
    ]);
  });
});
