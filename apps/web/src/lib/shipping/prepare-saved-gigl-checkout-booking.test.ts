import { describe, expect, it } from 'vitest';
import type { BookOrderRecord } from './book-order-shipment-types';
import { prepareSavedGiglCheckoutBooking } from './prepare-saved-gigl-checkout-booking';
import type { QuoteRequest } from './types';

const address = {
  address: '2 Buyer Road',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const order: BookOrderRecord = {
  id: 'order',
  customer_name: 'Buyer',
  customer_email: null,
  customer_phone: '08000000000',
  shipping_fee: 1100,
  selected_quote_id: 'saved',
  shipping_provider: 'GIGL',
  shipping_funding_source: 'customer_checkout',
  shipping_provider_cost: 1000,
  shipping_platform_margin: 100,
  shipping_address: address,
  order_items: [{ name: 'Phone', quantity: 1, price: 5000 }],
};
const request: QuoteRequest = {
  sessionId: 'session',
  shipmentType: 'domestic',
  receiver: {
    ...address,
    name: 'Buyer',
    phone: '08000000000',
    latitude: 6.5,
    longitude: 3.3,
  },
  items: [{ name: 'Phone', quantity: 1, value: 5000, weight: 1 }],
};

describe('prepareSavedGiglCheckoutBooking', () => {
  it('uses saved pins in memory while preserving bound quote and paid economics', () => {
    const prepared = prepareSavedGiglCheckoutBooking(
      'GIGL',
      false,
      order,
      request
    );
    expect(prepared.preserveSavedGiglCheckoutQuote).toBe(true);
    expect(prepared.bookingOrder).toMatchObject({
      selected_quote_id: 'saved',
      shipping_fee: 1100,
      shipping_provider_cost: 1000,
      shipping_platform_margin: 100,
      shipping_address: { latitude: 6.5, longitude: 3.3 },
    });
    expect(order.shipping_address).not.toHaveProperty('latitude');
  });
  it.each([
    ['TOPSHIP', false, 'customer_checkout'],
    ['GIGL', true, 'customer_checkout'],
    ['GIGL', false, 'merchant_wallet'],
    ['GIGL', false, null],
  ] as const)('leaves %s international=%s funding=%s on its existing path', (provider, international, funding) => {
    const original = { ...order, shipping_funding_source: funding };
    const prepared = prepareSavedGiglCheckoutBooking(
      provider,
      international,
      original,
      request
    );
    expect(prepared.preserveSavedGiglCheckoutQuote).toBe(false);
    expect(prepared.bookingOrder).toBe(original);
  });
  it('leaves an absent saved request for the existing quote validator to reject', () => {
    expect(prepareSavedGiglCheckoutBooking('GIGL', false, order, null)).toEqual(
      { preserveSavedGiglCheckoutQuote: true, bookingOrder: order }
    );
  });
  it('rejects a changed destination before any booking preparation succeeds', () => {
    expect(() =>
      prepareSavedGiglCheckoutBooking(
        'GIGL',
        false,
        { ...order, shipping_address: { ...address, address: 'Other Road' } },
        request
      )
    ).toThrow(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });
  it('requires consent when the original parcel contains refunded units', () => {
    const changed = {
      ...order,
      order_items: [
        {
          name: 'Phone',
          quantity: 2,
          price: 5000,
          fulfillment_data: { fulfillmentQuantity: 1 },
        },
      ],
    };
    const originalRequest = {
      ...request,
      items: [{ ...request.items[0], quantity: 2 }],
    };
    expect(() =>
      prepareSavedGiglCheckoutBooking('GIGL', false, changed, originalRequest)
    ).toThrow(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' })
    );
  });
});
