import { describe, expect, it } from 'vitest';
import { normalizeStorefrontHeader } from './normalize-storefront-header';

describe('normalizeStorefrontHeader', () => {
  it('trims and lowercases values and treats blank values as absent', () => {
    expect(normalizeStorefrontHeader('  Shop.Example.COM  ')).toBe(
      'shop.example.com'
    );
    expect(normalizeStorefrontHeader('  ')).toBeUndefined();
    expect(normalizeStorefrontHeader(null)).toBeUndefined();
  });
});
