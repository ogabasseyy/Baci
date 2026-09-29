import { describe, expect, it } from '@jest/globals';
import { parseRouteSearchQuery } from './parse-route-search-query';

describe('parseRouteSearchQuery', () => {
  it('accepts a single trimmed query at the search threshold', () => {
    expect(parseRouteSearchQuery('  iphone  ')).toBe('iphone');
  });

  it('rejects short, repeated, and missing params', () => {
    expect(parseRouteSearchQuery('i')).toBeNull();
    expect(parseRouteSearchQuery(['iphone', 'galaxy'])).toBeNull();
    expect(parseRouteSearchQuery(undefined)).toBeNull();
  });

  it('truncates over-long direct params to the shared maximum', () => {
    expect(parseRouteSearchQuery('a'.repeat(150))).toBe('a'.repeat(100));
  });
});
