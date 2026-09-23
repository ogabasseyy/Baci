import type { CartItem } from '@/stores/cart-store';
import {
  buildShippingQuoteContextKey,
  getPreferredShippingQuoteId,
  normalizeShippingQuotes,
} from './shipping-quotes';

describe('shipping quote helpers', () => {
  const items: CartItem[] = [
    {
      id: 'cart-1',
      product_id: 'prod-1',
      slug: 'prod-1',
      variant_id: 'var-1',
      quantity: 2,
      price: 1000,
      negotiatedPrice: undefined,
      name: 'Product 1',
    },
    {
      id: 'cart-2',
      product_id: 'prod-2',
      slug: 'prod-2',
      variant_id: undefined,
      quantity: 1,
      price: 500,
      negotiatedPrice: 450,
      negotiationStatus: 'accepted',
      name: 'Product 2',
    },
  ];

  it('builds a stable context key from location and cart contents', () => {
    const key = buildShippingQuoteContextKey('Lagos', 'Ikeja', items);

    expect(key).toBe(
      'lagos::ikeja::::["prod-1","var-1",2,1000,""]|["prod-2","",1,450,""]'
    );
  });

  it('changes the context key when assurance is toggled', () => {
    const withoutAssurance = buildShippingQuoteContextKey(
      'Lagos',
      'Ikeja',
      items
    );
    const withAssurance = buildShippingQuoteContextKey('Lagos', 'Ikeja', [
      { ...items[0], hasAssurance: true },
      items[1],
    ]);
    const withCustomRate = buildShippingQuoteContextKey('Lagos', 'Ikeja', [
      { ...items[0], hasAssurance: true, assuranceRate: 0.07 },
      items[1],
    ]);

    expect(withAssurance).not.toBe(withoutAssurance);
    expect(withCustomRate).not.toBe(withAssurance);
    expect(withAssurance).toContain('"default"');
  });

  it('includes a normalized address segment in the key', () => {
    const key = buildShippingQuoteContextKey(
      'Lagos',
      'Ikeja',
      items,
      '  Apt 2B  '
    );
    expect(key).toBe(
      'lagos::ikeja::apt 2b::["prod-1","var-1",2,1000,""]|["prod-2","",1,450,""]'
    );
  });

  it('produces distinct keys for different address values', () => {
    const key1 = buildShippingQuoteContextKey(
      'Lagos',
      'Ikeja',
      items,
      'Apt 2B'
    );
    const key2 = buildShippingQuoteContextKey(
      'Lagos',
      'Ikeja',
      items,
      'Apt 3C'
    );
    expect(key1).not.toBe(key2);
  });

  it('builds unambiguous keys when identifiers contain delimiters', () => {
    const key = buildShippingQuoteContextKey('Lagos', 'Ikeja', [
      {
        id: 'cart-1',
        product_id: 'prod:1|x',
        slug: 'prod-1',
        variant_id: 'var:1|y',
        quantity: 1,
        price: 1000,
        name: 'Product 1',
      },
    ]);

    expect(key).toContain('["prod:1|x","var:1|y",1,1000,""]');
  });

  it('keeps the previous quote selection when it still exists', () => {
    expect(
      getPreferredShippingQuoteId(
        [
          { id: 'a', price: 5000 },
          { id: 'b', price: 3500 },
        ],
        'a'
      )
    ).toBe('a');
  });

  it('falls back to the cheapest quote when the previous one is gone', () => {
    expect(
      getPreferredShippingQuoteId([
        { id: 'a', price: 5000 },
        { id: 'b', price: 3500 },
      ])
    ).toBe('b');
  });

  it('prefers door-delivery quotes over cheaper station-pickup quotes', () => {
    expect(
      getPreferredShippingQuoteId([
        { id: 'door', price: 5000 },
        { id: 'station', price: 3500, isStationPickup: true },
      ])
    ).toBe('door');
  });

  it('keeps GoFaster quotes out of automatic road selection', () => {
    expect(
      getPreferredShippingQuoteId([
        {
          id: 'gofaster',
          price: 2000,
          provider: 'GIGL',
          serviceTier: 'GoFaster',
        },
        {
          id: 'road',
          price: 5000,
          provider: 'GIGL',
          serviceTier: 'GoStandard',
        },
      ])
    ).toBe('road');
  });

  it('ignores a previous station-pickup selection when door quotes exist', () => {
    expect(
      getPreferredShippingQuoteId(
        [
          { id: 'door', price: 5000 },
          { id: 'station', price: 3500, isStationPickup: true },
        ],
        'station'
      )
    ).toBe('door');
  });

  it('returns no selection when only station-pickup quotes are available', () => {
    // A door order must never auto-select a station quote — the fee/order
    // builders zero it out, which would ship for free. Force the customer to
    // pick a station instead of silently selecting one for door delivery.
    expect(
      getPreferredShippingQuoteId([
        { id: 'station', price: 1500, isStationPickup: true },
      ])
    ).toBe('');
    expect(
      getPreferredShippingQuoteId(
        [{ id: 'station', price: 1500, isStationPickup: true }],
        'station'
      )
    ).toBe('');
  });

  it('normalizes string quote prices before selection and totals use them', () => {
    const quotes = normalizeShippingQuotes([
      { id: 'a', price: '₦6,500' },
      { id: 'b', price: '3638' },
    ]);

    expect(quotes).toEqual([
      { id: 'a', price: 6500 },
      { id: 'b', price: 3638 },
    ]);
    expect(getPreferredShippingQuoteId(quotes)).toBe('b');
  });
});
