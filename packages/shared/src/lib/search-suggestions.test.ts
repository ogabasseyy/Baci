import { describe, expect, it } from 'vitest';
import { buildCatalogSearchSuggestions } from './search-suggestions';

describe('catalog search suggestions', () => {
  it('offers observed conditions and a budget with matching products', () => {
    const suggestions = buildCatalogSearchSuggestions('iphone', 'iphone', [
      { price: 250000, condition: 'used' },
      { price: 900000, condition: 'new' },
    ]);
    expect(suggestions.map((item) => item.label)).toEqual([
      'Used iphone',
      'New iphone',
      'iphone up to ₦300,000',
    ]);
    expect(suggestions[2].proposal.filters.maxPrice).toBe(300000);
  });
  it('never suggests unavailable conditions or invents a price from missing rows', () => {
    expect(buildCatalogSearchSuggestions('iphone', 'iphone', [])).toEqual([]);
    expect(
      buildCatalogSearchSuggestions('iphone', 'iphone', [
        { price: Number.NaN, condition: 'new' },
      ]).map((s) => s.label)
    ).toEqual(['New iphone']);
  });
  it('suppresses stale suggestions while a different query is loading', () => {
    expect(
      buildCatalogSearchSuggestions('samsung', 'iphone', [
        { price: 100, condition: 'used' },
      ])
    ).toEqual([]);
    expect(
      buildCatalogSearchSuggestions('!!', '!!', [
        { price: 100, condition: 'used' },
      ])
    ).toEqual([]);
  });
  it('recognizes catalog condition aliases via canonical mapping', () => {
    expect(
      buildCatalogSearchSuggestions('iphone', 'iphone', [
        { price: 250000, condition: 'uk_used' },
        { price: 400000, condition: 'refurbished' },
      ]).map((s) => s.label)
    ).toEqual(['Used iphone', 'Open-box iphone', 'iphone up to ₦300,000']);
  });
});
