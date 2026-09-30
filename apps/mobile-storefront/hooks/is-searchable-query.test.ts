import { describe, expect, it } from '@jest/globals';
import { getSearchHintLabel, isSearchableQuery } from './is-searchable-query';

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

describe('getSearchHintLabel', () => {
  it('uses searchable-term guidance when the input is long enough but normalization-empty', () => {
    expect(getSearchHintLabel('!!')).toBe('Type letters or numbers to search');
  });

  it('uses length guidance for short or blank input', () => {
    expect(getSearchHintLabel('i')).toBe(
      'Type at least 2 characters to search'
    );
    expect(getSearchHintLabel('')).toBe('Type at least 2 characters to search');
    expect(getSearchHintLabel('iphone')).toBe(
      'Type at least 2 characters to search'
    );
  });
});
