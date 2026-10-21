import { describe, expect, it } from 'vitest';
import { toFiniteOfferPrice } from './to-finite-offer-price';

describe('toFiniteOfferPrice', () => {
  it('rejects blank values instead of pricing at zero', () => {
    expect(toFiniteOfferPrice(null)).toBeNull();
    expect(toFiniteOfferPrice(undefined)).toBeNull();
    expect(toFiniteOfferPrice('')).toBeNull();
    expect(toFiniteOfferPrice('abc')).toBeNull();
    expect(toFiniteOfferPrice('80.5')).toBe(80.5);
    expect(toFiniteOfferPrice(0)).toBe(0);
  });
});
