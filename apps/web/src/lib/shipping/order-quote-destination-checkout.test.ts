import { describe, expect, it } from 'vitest';
import {
  throwOrderQuoteMismatch,
  validateQuoteCheckoutContext,
} from './order-quote-destination-checkout';
import { OrderQuoteDestinationMismatchError } from './order-quote-destination-errors';
import type { parseStoredQuoteRequest } from './order-shipment-booking-utils';

type StoredQuoteRequest = NonNullable<
  ReturnType<typeof parseStoredQuoteRequest>
>;

const quoteItem = {
  name: 'Phone',
  quantity: 1,
  weight: 1,
  value: 100_000,
  length: 10,
  width: 8,
  height: 4,
  hsCode: '851712',
};

function makeQuoteRequest(
  overrides: Partial<StoredQuoteRequest> = {}
): StoredQuoteRequest {
  return {
    merchantId: 'merchant-1',
    sessionId: 'session-1',
    shipmentType: 'international',
    receiver: {
      name: 'Jane Receiver',
      phone: '+14165550123',
      address: '123 Queen Street West',
      city: 'Toronto',
      state: 'Ontario',
      country: 'Canada',
      countryCode: 'CA',
      postalCode: 'M5V 3L9',
    },
    items: [quoteItem],
    ...overrides,
  };
}

describe('validateQuoteCheckoutContext', () => {
  it('accepts a checkout context that matches the saved quote', () => {
    expect(() =>
      validateQuoteCheckoutContext(
        { price: 12_500, provider: 'GIGL' },
        makeQuoteRequest(),
        {
          merchantId: 'merchant-1',
          shippingFee: 12_500,
          shippingProvider: 'GIGL',
          items: [
            {
              name: 'Phone',
              quantity: 1,
              price: 100_000,
              weight: 1,
              length: 10,
              width: 8,
              height: 4,
              hsCode: '851712',
            },
          ],
        }
      )
    ).not.toThrow();
  });

  it('rejects when the shipping provider is missing or mismatched', () => {
    expect(() =>
      validateQuoteCheckoutContext(
        { price: 12_500, provider: 'GIGL' },
        makeQuoteRequest(),
        { shippingProvider: 'TOPSHIP', shippingFee: 12_500 }
      )
    ).toThrow(
      expect.objectContaining({
        code: 'INTERNATIONAL_QUOTE_PROVIDER_MISMATCH',
        status: 400,
      })
    );

    expect(() =>
      validateQuoteCheckoutContext(
        { price: 12_500, provider: null },
        makeQuoteRequest(),
        { shippingProvider: 'GIGL', shippingFee: 12_500 }
      )
    ).toThrow(OrderQuoteDestinationMismatchError);
  });

  it('rejects when the merchant id does not match the quote request', () => {
    expect(() =>
      validateQuoteCheckoutContext(
        { price: 12_500, provider: 'GIGL' },
        makeQuoteRequest(),
        {
          merchantId: 'merchant-other',
          shippingProvider: 'GIGL',
          shippingFee: 12_500,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code: 'INTERNATIONAL_QUOTE_MERCHANT_MISMATCH',
      })
    );
  });

  it('rejects when the shipping fee does not match the quote price', () => {
    expect(() =>
      validateQuoteCheckoutContext(
        { price: 12_500, provider: 'GIGL' },
        makeQuoteRequest(),
        {
          merchantId: 'merchant-1',
          shippingProvider: 'GIGL',
          shippingFee: 9_999,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      })
    );
  });

  it('rejects when checkout items do not match the quote items', () => {
    expect(() =>
      validateQuoteCheckoutContext(
        { price: 12_500, provider: 'GIGL' },
        makeQuoteRequest(),
        {
          merchantId: 'merchant-1',
          shippingProvider: 'GIGL',
          shippingFee: 12_500,
          items: [{ name: 'Tablet', quantity: 1, price: 100_000, weight: 1 }],
        }
      )
    ).toThrow(
      expect.objectContaining({
        code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      })
    );
  });
});

describe('throwOrderQuoteMismatch', () => {
  it('throws OrderQuoteDestinationMismatchError with the provided code', () => {
    expect(() =>
      throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_EXPIRED', 410)
    ).toThrow(
      expect.objectContaining({
        code: 'INTERNATIONAL_QUOTE_EXPIRED',
        status: 410,
        name: 'OrderQuoteDestinationMismatchError',
      })
    );
  });
});
