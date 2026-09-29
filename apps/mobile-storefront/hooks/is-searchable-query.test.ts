import { describe, expect, it } from '@jest/globals';
import { isSearchableQuery } from './is-searchable-query';

describe('isSearchableQuery', () => {
  it('accepts queries with searchable content', () => {
    expect(isSearchableQuery('iphone')).toBe(true);
    expect(isSearchableQuery('  iPhone 16  ')).toBe(true);
    expect(isSearchableQuery('a!')).toBe(true);
  });

  it('rejects punctuation-only and blank queries', () => {
    expect(isSearchableQuery('!!')).toBe(false);
    expect(isSearchableQuery('()')).toBe(false);
    expect(isSearchableQuery('   ')).toBe(false);
    expect(isSearchableQuery('')).toBe(false);
  });
});
