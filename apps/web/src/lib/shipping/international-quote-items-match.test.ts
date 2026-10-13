import { describe, expect, it } from 'vitest';
import { assertQuoteItemsMatchOrder } from './international-quote-items-match';
import type { QuoteRequest } from './types';

const baseQuote: QuoteRequest = {
  sessionId: 'session-1',
  shipmentType: 'domestic',
  receiver: {
    name: 'Jane Receiver',
    phone: '',
    email: 'jane@example.com',
    address: '12 Admiralty Way',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Widget', quantity: 1, weight: 1, value: 5000 }],
};

describe('assertQuoteItemsMatchOrder', () => {
  it('rejects a heavier domestic item set against the attested quote', () => {
    expect(() =>
      assertQuoteItemsMatchOrder(baseQuote, [
        { name: 'Widget', quantity: 1, price: 5000, weight: 4 },
      ])
    ).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_ITEMS_MISMATCH' })
    );
  });

  it('rejects attested quote dimensions that no longer match the order', () => {
    const quoteWithDimensions: QuoteRequest = {
      ...baseQuote,
      items: [
        {
          name: 'Widget',
          quantity: 1,
          weight: 1,
          value: 5000,
          length: 10,
          width: 8,
          height: 6,
        },
      ],
    };

    expect(() =>
      assertQuoteItemsMatchOrder(quoteWithDimensions, [
        {
          name: 'Widget',
          quantity: 1,
          price: 5000,
          weight: 1,
          length: 20,
          width: 15,
          height: 10,
        },
      ])
    ).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_ITEMS_MISMATCH' })
    );
  });

  it('bugfix: rejects quotes that omit newly added package dimensions', () => {
    expect(() =>
      assertQuoteItemsMatchOrder(baseQuote, [
        {
          name: 'Widget',
          quantity: 1,
          price: 5000,
          weight: 1,
          length: 10,
          width: 8,
          height: 6,
        },
      ])
    ).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_ITEMS_MISMATCH' })
    );
  });
});
