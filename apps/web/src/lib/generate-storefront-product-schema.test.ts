import { describe, expect, it } from 'vitest';
import { generateStorefrontProductSchema } from './generate-storefront-product-schema';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateStorefrontProductSchema', () => {
  it('forwards schema options while supplying durable narrative copy', () => {
    const schema = generateStorefrontProductSchema(
      makeSeoProduct({
        name: 'Phone',
        description: 'Buy this phone for ₦350,000.',
      }),
      'Ogabassey',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        acceptedPaymentMethods: ['Pay on delivery'],
        productUrl: 'https://ogabassey.com/smartphones/phone',
      }
    );

    expect(schema.description).toBe(
      'Buy Phone from Ogabassey. Best prices, fast delivery, and secure payments.'
    );
    expect(schema.url).toBe('https://ogabassey.com/smartphones/phone');
    expect(schema.offers).toMatchObject({
      acceptedPaymentMethod: ['https://schema.org/COD'],
    });
  });
});
