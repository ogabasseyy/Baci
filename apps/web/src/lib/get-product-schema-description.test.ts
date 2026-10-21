import { describe, expect, it } from 'vitest';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('getProductSchemaDescription through Product JSON-LD', () => {
  it.each([
    {
      description: 'Buy this phone for ₦350,000',
      meta_description: 'Price: NGN 350k',
    },
    { description: '', meta_description: '<p>Buy for ₦&nbsp;350,000</p>' },
  ])('does not publish stored prices in schema descriptions: %j', (copy) => {
    const schema = generateProductSchema(
      makeSeoProduct({ name: 'iPhone 13', price: 390500, ...copy }),
      'Ogabassey',
      'NGN'
    );
    expect(schema.description).toBe(
      'Buy iPhone 13 from Ogabassey. Best prices, fast delivery, and secure payments.'
    );
    expect(schema.offers).toMatchObject({
      price: 390500,
      priceCurrency: 'NGN',
    });
  });

  it('falls back to useful price-free meta copy when visible copy has a price', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        name: 'iPhone 13',
        description: 'Buy for ₦350,000',
        meta_description: 'Compare 128GB and 256GB models.',
      }),
      'Ogabassey',
      'NGN'
    );
    expect(schema.description).toBe('Compare 128GB and 256GB models.');
  });

  it('preserves visible specifications and gift-card identity', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        name: 'Amazon Gift Card 50 USD',
        description: 'Use this 50 USD Amazon gift card for purchases.',
      }),
      'Ogabassey',
      'NGN'
    );
    expect(schema.description).toBe(
      'Use this 50 USD Amazon gift card for purchases.'
    );
  });
});
