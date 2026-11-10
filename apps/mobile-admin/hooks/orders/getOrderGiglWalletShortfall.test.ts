import { describe, expect, it } from 'vitest';
import { getOrderGiglWalletShortfall } from './getOrderGiglWalletShortfall';

describe('getOrderGiglWalletShortfall', () => {
  it('can book when the balance covers the price', () => {
    expect(getOrderGiglWalletShortfall(5000, 4500)).toEqual({
      availableBalance: 5000,
      canBook: true,
      shortfall: 0,
    });
  });

  it('reports the shortfall when the balance is too low', () => {
    expect(getOrderGiglWalletShortfall(1000, 4500)).toEqual({
      availableBalance: 1000,
      canBook: false,
      shortfall: 3500,
    });
  });

  it('cannot book a zero price (no quote yet)', () => {
    expect(getOrderGiglWalletShortfall(1000, 0).canBook).toBe(false);
  });
});
