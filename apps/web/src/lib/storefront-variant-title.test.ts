import { describe, expect, it } from 'vitest';
import { buildStorefrontVariantTitle } from './storefront-variant-title';

describe('storefront-variant-title', () => {
  it('builds descriptive product titles with normalized variant options', () => {
    const title = buildStorefrontVariantTitle('iPhone 15 Pro', {
      id: 'v1',
      attributes: {
        Color: 'Blue Titanium',
        Storage: '256GB',
      },
      condition: 'open_box',
    });

    expect(title).toBe('iPhone 15 Pro - Blue Titanium - 256GB - Open Box');
  });
});
