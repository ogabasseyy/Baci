import { describe, expect, it } from 'vitest';
import { parseRouteProductNumber } from './parse-route-product-number';

describe('parseRouteProductNumber', () => {
  it('parses numeric and string prices with comma formatting', () => {
    expect(parseRouteProductNumber(100)).toBe(100);
    expect(parseRouteProductNumber(' 1,250.50 ')).toBe(1250.5);
    expect(parseRouteProductNumber('invalid')).toBeNull();
    expect(parseRouteProductNumber(null)).toBeNull();
    expect(parseRouteProductNumber(undefined)).toBeNull();
  });
});
