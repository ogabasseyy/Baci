import { describe, expect, it } from 'vitest';
import {
  assertInternationalQuoteMatchesOrder,
  assertQuoteReceiverMatchesOrder,
} from './international-quote-order-guard';
import type { QuoteRequest } from './types';

const quoteRequest: QuoteRequest = {
  sessionId: 'session-1',
  shipmentType: 'international',
  receiver: {
    name: 'Jane Receiver',
    phone: '',
    email: 'old-recipient@example.com',
    address: '123 Queen Street West',
    city: 'Toronto',
    state: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
    postalCode: 'M5V 3L9',
  },
  items: [
    {
      name: 'Phone',
      quantity: 1,
      weight: 1.2,
      value: 100_000,
      hsCode: '851712',
      length: 10,
      width: 8,
      height: 6,
    },
  ],
};

const matchingOrder = {
  shipping_address: {
    address: '123 Queen Street West',
    city: 'Toronto',
    state: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
    postalCode: 'M5V 3L9',
  },
  order_items: [
    {
      name: 'Phone',
      quantity: 1,
      price: 100_000,
      length: 10,
      width: 8,
      height: 6,
    },
  ],
};

describe('assertInternationalQuoteMatchesOrder', () => {
  it('allows saved quote metadata when order address and items still match', () => {
    expect(() =>
      assertInternationalQuoteMatchesOrder(quoteRequest, matchingOrder)
    ).not.toThrow();
  });

  it('rejects stale saved quote destinations before booking', () => {
    expect(() =>
      assertInternationalQuoteMatchesOrder(quoteRequest, {
        ...matchingOrder,
        shipping_address: {
          ...matchingOrder.shipping_address,
          city: 'Vancouver',
        },
      })
    ).toThrow('no longer matches this order');
  });

  it('rejects stale saved quote country and postal code fields before booking', () => {
    expect(() =>
      assertInternationalQuoteMatchesOrder(quoteRequest, {
        ...matchingOrder,
        shipping_address: {
          ...matchingOrder.shipping_address,
          countryCode: 'US',
          postalCode: '10001',
        },
      })
    ).toThrow('no longer matches this order');
  });

  it('rejects orders missing a postal code when the saved quote has one', () => {
    expect(() =>
      assertInternationalQuoteMatchesOrder(quoteRequest, {
        ...matchingOrder,
        shipping_address: {
          ...matchingOrder.shipping_address,
          postalCode: undefined,
        },
      })
    ).toThrow('no longer matches this order');
  });

  it('matches saved quote items independent of order row order', () => {
    const multiItemQuoteRequest: QuoteRequest = {
      ...quoteRequest,
      items: [
        ...quoteRequest.items,
        {
          name: 'Laptop',
          quantity: 2,
          weight: 1.5,
          value: 250_000,
        },
      ],
    };

    expect(() =>
      assertInternationalQuoteMatchesOrder(multiItemQuoteRequest, {
        ...matchingOrder,
        order_items: [
          { name: 'Laptop', quantity: 2, price: 250_000 },
          {
            name: 'Phone',
            quantity: 1,
            price: 100_000,
            length: 10,
            width: 8,
            height: 6,
          },
        ],
      })
    ).not.toThrow();
  });

  it('rejects saved quote item values that no longer match the order', () => {
    expect(() =>
      assertInternationalQuoteMatchesOrder(quoteRequest, {
        ...matchingOrder,
        order_items: [
          {
            name: 'Phone',
            quantity: 1,
            price: 80_000,
            length: 10,
            width: 8,
            height: 6,
          },
        ],
      })
    ).toThrow('no longer matches this order');
  });

  it('rejects stale saved quote items before booking', () => {
    expect(() =>
      assertInternationalQuoteMatchesOrder(quoteRequest, {
        ...matchingOrder,
        order_items: [
          {
            name: 'Phone',
            quantity: 2,
            price: 100_000,
            length: 10,
            width: 8,
            height: 6,
          },
        ],
      })
    ).toThrow('no longer matches this order');
  });

  it('bugfix: rejects quotes that omit newly added package dimensions', () => {
    const quoteWithoutDimensions: QuoteRequest = {
      ...quoteRequest,
      items: [
        {
          name: 'Phone',
          quantity: 1,
          weight: 1.2,
          value: 100_000,
          hsCode: '851712',
        },
      ],
    };

    expect(() =>
      assertInternationalQuoteMatchesOrder(
        quoteWithoutDimensions,
        matchingOrder
      )
    ).toThrow('no longer matches this order');
  });

  it('bugfix: flattens nested product.dimensions before comparing to the quote', () => {
    expect(() =>
      assertInternationalQuoteMatchesOrder(quoteRequest, {
        ...matchingOrder,
        order_items: [
          {
            name: 'Phone',
            quantity: 1,
            price: 100_000,
            product: {
              weight_value: 1.2,
              weight_unit: 'kg',
              dimensions: { length: 10, width: 8, height: 6, unit: 'cm' },
            },
          },
        ],
      })
    ).not.toThrow();
  });
});

describe('assertQuoteReceiverMatchesOrder', () => {
  it('treats omitted order country fields as the domestic Nigeria defaults', () => {
    const domesticQuote: QuoteRequest = {
      ...quoteRequest,
      shipmentType: 'domestic',
      receiver: {
        ...quoteRequest.receiver,
        country: 'Nigeria',
        countryCode: 'NG',
        city: 'Lagos',
        state: 'Lagos',
        postalCode: undefined,
      },
    };

    expect(() =>
      assertQuoteReceiverMatchesOrder(domesticQuote, {
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Lagos',
          state: 'Lagos',
        },
      })
    ).not.toThrow();
  });

  it('defaults blank quote and order country fields for domestic comparisons', () => {
    const domesticQuote: QuoteRequest = {
      ...quoteRequest,
      shipmentType: 'domestic',
      receiver: {
        ...quoteRequest.receiver,
        address: '12 Admiralty Way',
        city: 'Lagos',
        state: 'Lagos',
        country: '',
        countryCode: '',
        postalCode: undefined,
      },
    };

    expect(() =>
      assertQuoteReceiverMatchesOrder(domesticQuote, {
        shipping_address: {
          address: '12 Admiralty Way',
          city: 'Lagos',
          state: 'Lagos',
          country: '',
          countryCode: '',
        },
      })
    ).not.toThrow();
  });

  describe('bugfix: composed domestic street still matches quote street', () => {
    it('accepts order address that appends city and state to the quote street', () => {
      const domesticQuote: QuoteRequest = {
        ...quoteRequest,
        shipmentType: 'domestic',
        receiver: {
          ...quoteRequest.receiver,
          address: '12 Admiralty Way',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
          postalCode: undefined,
        },
      };

      expect(() =>
        assertQuoteReceiverMatchesOrder(domesticQuote, {
          shipping_address: {
            address: '12 Admiralty Way, Lagos, Lagos',
            city: 'Lagos',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
        })
      ).not.toThrow();
    });
  });

  it('rejects a domestic quote when the order destination changed', () => {
    const domesticQuote: QuoteRequest = {
      ...quoteRequest,
      shipmentType: 'domestic',
      receiver: {
        ...quoteRequest.receiver,
        country: 'Nigeria',
        countryCode: 'NG',
        city: 'Lagos',
        state: 'Lagos',
      },
    };

    expect(() =>
      assertQuoteReceiverMatchesOrder(domesticQuote, {
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Abuja',
          state: 'FCT',
          country: 'Nigeria',
          countryCode: 'NG',
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });
});
