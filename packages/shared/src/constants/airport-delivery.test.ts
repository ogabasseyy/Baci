import { describe, expect, it } from 'vitest';
import { AIRPORT_DELIVERY_FEES } from './airport-delivery';

describe('AIRPORT_DELIVERY_FEES', () => {
  it('keeps the fixed delivery and pickup prices in one shared source', () => {
    expect(AIRPORT_DELIVERY_FEES).toEqual({
      delivery: 35_000,
      pickup: 20_000,
      legacy: 25_000,
    });
  });
});
