import { describe, expect, it } from 'vitest';
import { buildStorefrontVariantUrl } from './storefront-variant-url';

describe('storefront-variant-url', () => {
  it('appends variantId and public attributes to product URL search params', () => {
    const url = buildStorefrontVariantUrl(
      'https://store.example.com/products/iphone-15',
      {
        id: 'var-123',
        attributes: { color: 'Blue', storage: '128GB' },
        condition: 'brand_new',
      }
    );

    const parsed = new URL(url);
    expect(parsed.searchParams.get('variantId')).toBe('var-123');
    expect(parsed.searchParams.get('color')).toBe('Blue');
    expect(parsed.searchParams.get('storage')).toBe('128GB');
    expect(parsed.searchParams.get('condition')).toBe('brand_new');
  });

  it('safely handles relative URLs without throwing TypeError', () => {
    const url = buildStorefrontVariantUrl('/products/iphone-16', {
      id: 'var-456',
      attributes: { storage: '256GB' },
    });

    expect(url).toBe('/products/iphone-16?variantId=var-456&storage=256GB');
  });
});
