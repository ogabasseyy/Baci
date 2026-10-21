import { describe, expect, it } from 'vitest';
import { generateCartItemId } from '@/hooks/cart/cart-storage';
import { buildCartItemId } from './cart-item-id';

describe('buildCartItemId provider parity', () => {
  it('matches generateCartItemId for an exact-offer add with attributes', () => {
    const providerId = generateCartItemId('prod-1', {
      color: 'Black',
      condition: 'used',
      offerId: 'offer-b',
      storage: '128GB',
      capacity: '128GB',
    });
    expect(
      buildCartItemId('prod-1', {
        color: 'Black',
        condition: 'used',
        offerId: 'offer-b',
        selectedAttributes: { storage: '128GB', capacity: '128GB' },
      })
    ).toBe(providerId);
    expect(providerId).toBe(
      'prod-1::color=Black::condition=used::capacity=128GB::offerId=offer-b::storage=128GB'
    );
  });

  it('omits the offer segment when no offer priced the selection', () => {
    expect(
      buildCartItemId('prod-1', {
        condition: 'new',
        selectedAttributes: {},
      })
    ).toBe('prod-1::condition=new');
  });
});
