import { describe, expect, it } from 'vitest';
import { parseStorefrontSearchQueryParam } from './storefront-search-params';

describe('parseStorefrontSearchQueryParam', () => {
  it('sanitizes a single query string', () => {
    expect(parseStorefrontSearchQueryParam('  iphone 15 ')).toBe('iphone 15');
  });

  it('rejects repeated query parameters', () => {
    expect(parseStorefrontSearchQueryParam(['iphone', 'galaxy'])).toBe('');
  });

  it('returns empty for missing values', () => {
    expect(parseStorefrontSearchQueryParam(undefined)).toBe('');
    expect(parseStorefrontSearchQueryParam(null)).toBe('');
  });
});
