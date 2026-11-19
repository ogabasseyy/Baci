import { describe, expect, it } from 'vitest';
import {
  generateCollectionPageSchema,
  toAbsoluteSchemaUrl,
} from './collection-page-schema';

describe('collection-page-schema', () => {
  it('resolves valid relative URLs and returns empty string for invalid URLs', () => {
    expect(toAbsoluteSchemaUrl('https://ogabassey.com', '/smartphones')).toBe(
      'https://ogabassey.com/smartphones'
    );
    expect(toAbsoluteSchemaUrl('https://ogabassey.com', '')).toBe('');
    expect(toAbsoluteSchemaUrl('not a url', 'http://[invalid')).toBe('');
  });

  it('emits normalized #collection @id and ItemList products for category pages', () => {
    const schema = generateCollectionPageSchema({
      name: 'Smartphones',
      description: 'Compare latest smartphones in Nigeria.',
      url: 'https://ogabassey.com/smartphones/',
      merchantName: 'Ogabassey',
      currency: 'NGN',
      products: [
        {
          id: 'prod-1',
          name: 'iPhone 16',
          slug: 'iphone-16',
          category_slug: 'smartphones',
          price: 1200000,
          image: 'https://cdn.ogabassey.com/products/iphone-16.jpg',
          stock_quantity: 5,
          manage_stock: true,
        },
      ],
    });

    expect(schema['@id']).toBe('https://ogabassey.com/smartphones#collection');
    expect(schema.url).toBe('https://ogabassey.com/smartphones/');
    expect(schema.mainEntity).toMatchObject({
      '@type': 'ItemList',
      numberOfItems: 1,
    });
  });
});
