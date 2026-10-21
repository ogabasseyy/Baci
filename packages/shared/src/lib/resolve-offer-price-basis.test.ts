import { describe, expect, it } from 'vitest';
import { resolveOfferPriceBasis } from './resolve-offer-price-basis';

describe('resolveOfferPriceBasis', () => {
  it('prices from the finite offer price, else the parent', () => {
    expect(resolveOfferPriceBasis('80', 100)).toBe(80);
    expect(resolveOfferPriceBasis(null, 100)).toBe(100);
    expect(resolveOfferPriceBasis('', 100)).toBe(100);
  });
});
