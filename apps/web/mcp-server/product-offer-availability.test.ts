import { describe, expect, it } from 'vitest';
import { getMcpOfferAvailability } from './product-offer-availability';

describe('getMcpOfferAvailability', () => {
  it('distinguishes untracked, stocked, and sold-out offers', () => {
    expect(getMcpOfferAvailability(false, 0)).toEqual({ availability: 'unconfirmed', label: 'Confirm availability' });
    expect(getMcpOfferAvailability(true, 2)).toEqual({ availability: 'in_stock', label: 'In Stock' });
    expect(getMcpOfferAvailability(true, 0)).toEqual({ availability: 'out_of_stock', label: 'Out of Stock' });
  });
});
