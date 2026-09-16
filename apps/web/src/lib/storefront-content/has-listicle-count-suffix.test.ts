import { describe, expect, it } from 'vitest';
import { hasListicleCountSuffix } from './has-listicle-count-suffix';

describe('hasListicleCountSuffix', () => {
  it('matches an identifier phrase followed by a separator and digits', () => {
    expect(
      hasListicleCountSuffix('Apple iPhone 15 — 7 Reasons to Buy', [
        'apple',
        'iphone',
        '15',
      ])
    ).toBe(true);
    expect(hasListicleCountSuffix('iPhone 15: 10 tips', ['iphone', '15'])).toBe(
      true
    );
  });

  it('rejects titles without a trailing count', () => {
    expect(hasListicleCountSuffix('iPhone 15', ['iphone', '15'])).toBe(false);
    expect(hasListicleCountSuffix('Top 10 iPhone 15 cases', ['iphone', '15']))
      .toBe(false);
  });

  it('matches identifier tokens literally, not as a pattern', () => {
    expect(hasListicleCountSuffix('a+b (new): 3', ['a+b', '(new)'])).toBe(true);
    expect(hasListicleCountSuffix('abc: 5', ['a.c'])).toBe(false);
    expect(hasListicleCountSuffix('price 100: 5', ['$100'])).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(hasListicleCountSuffix('iPhone 15 — 7', [])).toBe(false);
    expect(hasListicleCountSuffix('', ['iphone'])).toBe(false);
  });
});
