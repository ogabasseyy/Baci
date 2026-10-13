import { describe, expect, it } from 'vitest';
import { formatSearchSummary } from './search-page-summary';

describe('formatSearchSummary', () => {
  it('prompts for an initial query', () => {
    expect(
      formatSearchSummary({
        query: '',
        totalCount: 0,
        visibleCount: 0,
        page: 1,
      })
    ).toBe('Enter a search term to browse matching products.');
  });

  it('names the query on zero matches', () => {
    expect(
      formatSearchSummary({
        query: 'iphon',
        totalCount: 0,
        visibleCount: 0,
        page: 1,
      })
    ).toBe('No results found for “iphon”');
  });

  it('summarizes a full first page', () => {
    expect(
      formatSearchSummary({
        query: 'iphone',
        totalCount: 45,
        visibleCount: 20,
        page: 1,
      })
    ).toBe('Showing first 20 of 45 results for “iphone”');
  });

  it('summarizes a later page as a truthful range', () => {
    expect(
      formatSearchSummary({
        query: 'iphone',
        totalCount: 45,
        visibleCount: 20,
        page: 2,
      })
    ).toBe('Showing 21–40 of 45 results for “iphone”');
  });

  it('summarizes a fully loaded result set', () => {
    expect(
      formatSearchSummary({
        query: 'iphone',
        totalCount: 1,
        visibleCount: 1,
        page: 1,
      })
    ).toBe('1 result for “iphone”');
  });
});
