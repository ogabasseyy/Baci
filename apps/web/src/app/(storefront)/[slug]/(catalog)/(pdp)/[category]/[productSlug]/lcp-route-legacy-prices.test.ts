import { describe, expect, it } from 'vitest';
import {
  getLcpRouteLegacyPrices,
  parseRouteProductNumber,
} from './lcp-route-legacy-prices';

describe('lcp-route-legacy-prices', () => {
  it('parses numeric and string prices with comma formatting', () => {
    expect(parseRouteProductNumber(100)).toBe(100);
    expect(parseRouteProductNumber(' 1,250.50 ')).toBe(1250.5);
    expect(parseRouteProductNumber('invalid')).toBeNull();
    expect(parseRouteProductNumber(null)).toBeNull();
    expect(parseRouteProductNumber(undefined)).toBeNull();
  });

  it('calculates legacy prices correctly when sale exists', () => {
    const prices = getLcpRouteLegacyPrices({
      price: '800',
      compare_at_price: '1000',
    });
    expect(prices).toEqual({
      basePrice: 1000,
      compareAtPrice: 1000,
      price: 800,
      salePrice: 800,
    });
  });

  it('calculates legacy prices correctly without sale', () => {
    const prices = getLcpRouteLegacyPrices({
      price: '1000',
      compare_at_price: '800',
    });
    expect(prices).toEqual({
      basePrice: 1000,
      compareAtPrice: 800,
      price: 1000,
      salePrice: null,
    });
  });
});
