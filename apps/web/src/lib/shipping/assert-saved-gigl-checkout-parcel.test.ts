import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSavedGiglCheckoutParcel } from './assert-saved-gigl-checkout-parcel';
import * as quoteItems from './international-quote-items-match';
import type { QuoteRequest } from './types';

const request: QuoteRequest = {
  sessionId: 'synthetic',
  shipmentType: 'domestic',
  receiver: {
    name: 'Synthetic Buyer',
    phone: '08000000000',
    address: '2 Test Road',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 5000 }],
};
const items = [
  {
    name: 'Phone',
    quantity: 2,
    price: 5000,
    fulfillment_data: { fulfillmentQuantity: 1 },
  },
];

afterEach(() => vi.restoreAllMocks());

describe('saved GIG checkout parcel consent', () => {
  it('accepts a complete surviving snapshot', () => {
    expect(() => assertSavedGiglCheckoutParcel(request, items)).not.toThrow();
  });
  it('requires confirmation when a valid original snapshot includes refunded units', () => {
    expect(() =>
      assertSavedGiglCheckoutParcel(
        {
          ...request,
          items: [{ ...request.items[0], quantity: 2 }],
        },
        items
      )
    ).toThrow(
      expect.objectContaining({
        code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
        status: 409,
      })
    );
  });
  it('preserves invalid snapshot rejection rather than offering consent', () => {
    expect(() =>
      assertSavedGiglCheckoutParcel(
        {
          ...request,
          items: [{ ...request.items[0], quantity: 3 }],
        },
        items
      )
    ).toThrow(
      expect.objectContaining({
        code: 'SHIPPING_QUOTE_ITEMS_MISMATCH',
        status: 400,
      })
    );
  });
  it('never permits booking when no units survive', () => {
    expect(() =>
      assertSavedGiglCheckoutParcel(request, [
        {
          ...items[0],
          quantity: 1,
          fulfillment_data: { fulfillmentQuantity: 0 },
        },
      ])
    ).toThrow(expect.objectContaining({ code: 'NO_SHIPPABLE_ITEMS' }));
  });
  it('preserves unexpected comparison errors unchanged', () => {
    const original = quoteItems.assertQuoteItemsMatchOrder;
    const failure = new Error('Unexpected comparison failure');
    vi.spyOn(quoteItems, 'assertQuoteItemsMatchOrder')
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => {
        throw failure;
      });
    expect(() => assertSavedGiglCheckoutParcel(request, items)).toThrow(
      failure
    );
  });
});
