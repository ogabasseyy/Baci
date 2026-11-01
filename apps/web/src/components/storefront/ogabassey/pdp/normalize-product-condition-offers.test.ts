import { describe, expect, it } from 'vitest';
import { normalizeProductConditionOffers } from './normalize-product-condition-offers';

describe('normalizeProductConditionOffers', () => {
  it('preserves the selected offer allocation', () => {
    const raw = { id: 'used', condition: 'used', price: 100, stock_quantity: 5, allocatable_stock: 2 };
    expect(normalizeProductConditionOffers([raw], String)?.[0]?.allocatable_stock).toBe(2);
  });
  it('normalizes prices and preserves condition-offer display metadata', () => {
    const offers = normalizeProductConditionOffers(
      [
        {
          compare_at_price: '850000',
          condition: 'open_box',
          condition_notes: 'Light cosmetic wear',
          grade: 'A',
          id: 'offer-open-box',
          images: ['https://cdn.example/open-box.avif'],
          price: '800000',
          stock_quantity: 2,
        },
      ],
      (value) => `₦${value.toLocaleString('en-NG')}`
    );

    expect(offers).toEqual([
      {
        compare_at_price: '₦850,000',
        condition: 'open_box',
        grade: 'A',
        id: 'offer-open-box',
        images: ['https://cdn.example/open-box.avif'],
        notes: 'Light cosmetic wear',
        price: '₦800,000',
        rawPrice: 800000,
        stock: 2,
      },
    ]);
  });

  it('omits unknown conditions and preserves an absent offer collection', () => {
    expect(
      normalizeProductConditionOffers(
        [{ condition: 'sample', id: 'invalid', price: 1 }],
        String
      )
    ).toEqual([]);
    expect(normalizeProductConditionOffers(null, String)).toBeUndefined();
  });

  it('omits offers with malformed prices instead of treating them as free', () => {
    expect(
      normalizeProductConditionOffers(
        [
          { condition: 'new', id: 'bad-price', price: 'not-a-price' },
          { condition: 'new', id: 'partial-price', price: '100invalid' },
          {
            condition: 'new',
            id: 'bad-compare',
            price: 100,
            compare_at_price: 'invalid',
          },
          { condition: 'new', id: 'valid', price: 100 },
        ],
        String
      )
    ).toEqual([
      expect.objectContaining({ id: 'valid', rawPrice: 100, price: '100' }),
    ]);
  });
});
