import { describe, expect, it } from 'vitest';
import { tokenizeContentText } from './tokenize-content-text';

describe('tokenizeContentText', () => {
  it('normalizes currency, apostrophes, and plus signs before splitting', () => {
    expect(tokenizeContentText("Samsung's Galaxy S24+ £50")).toEqual([
      'samsung',
      'galaxy',
      's24',
      'plus',
      'gbp',
      '50',
    ]);
  });

  it('returns no tokens for nullish input', () => {
    expect(tokenizeContentText(null)).toEqual([]);
    expect(tokenizeContentText(undefined)).toEqual([]);
  });

  it('splits mixed alphanumeric game codes like conventional guide titles', () => {
    expect(tokenizeContentText('NBA2K24 Buyer Guide')).toEqual([
      'nba',
      '2k24',
      'buyer',
      'guide',
    ]);
  });

  it('splits compact model tiers like conventional guide titles', () => {
    expect(tokenizeContentText('Samsung Galaxy S24FE Buyer Guide')).toEqual([
      'samsung',
      'galaxy',
      's24',
      'fe',
      'buyer',
      'guide',
    ]);
  });
});
