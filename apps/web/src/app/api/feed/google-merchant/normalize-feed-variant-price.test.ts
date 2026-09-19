import { describe, expect, it } from 'vitest';
import { normalizeFeedVariantPrice } from './normalize-feed-variant-price';

describe('normalizeFeedVariantPrice', () => {
  it('passes finite numbers through', () => {
    expect(normalizeFeedVariantPrice(10)).toBe(10);
    expect(normalizeFeedVariantPrice(0)).toBe(0);
  });

  it('rejects non-finite numbers', () => {
    expect(normalizeFeedVariantPrice(Number.NaN)).toBeNull();
    expect(normalizeFeedVariantPrice(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('parses numeric strings', () => {
    expect(normalizeFeedVariantPrice('10.5')).toBe(10.5);
  });

  it('rejects non-numeric strings and missing values', () => {
    expect(normalizeFeedVariantPrice('abc')).toBeNull();
    // Number('') is 0, so a blank override normalizes to zero rather than null.
    expect(normalizeFeedVariantPrice('')).toBe(0);
    expect(normalizeFeedVariantPrice(null)).toBeNull();
    expect(normalizeFeedVariantPrice(undefined)).toBeNull();
  });
});
