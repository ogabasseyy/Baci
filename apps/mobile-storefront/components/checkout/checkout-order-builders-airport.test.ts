import { describe, expect, it } from '@jest/globals';
import {
  buildCheckoutOrderRequest,
  createCheckoutSnapshot,
} from './checkout-order-builders';

const address = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '08012345678',
  address: '1 Test Street',
  city: 'Lagos',
  state: 'Lagos',
};

const itemsSnapshot = [
  {
    id: 'line-1',
    product_id: 'product-1',
    slug: 'iphone-13',
    name: 'iPhone 13',
    price: 500000,
    quantity: 1,
  },
];

describe('checkout order builders airport delivery', () => {
  it('keeps airport_type undefined for a provider-backed GoFaster quote', () => {
    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'airport',
      itemsSnapshot,
      paymentMethodForOrder: 'paystack',
      selectedQuote: {
        id: 'gofaster-quote',
        displayName: 'GIG Logistics - GoFaster',
        price: 18500,
        provider: 'GIGL',
        serviceTier: 'GoFaster',
      },
      shippingProvider: 'GIGL',
      snapshot: createCheckoutSnapshot(itemsSnapshot, 18500, 0),
    });

    expect(request.selected_quote_id).toBe('gofaster-quote');
    expect(request.shipping_provider).toBe('GIGL');
    expect(request.delivery_method).toBe('airport');
    expect(request.airport_type).toBeUndefined();
  });

  it('sets airport_type to delivery for a fixed airport order without a GoFaster quote', () => {
    const request = buildCheckoutOrderRequest({
      address,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'airport',
      itemsSnapshot,
      paymentMethodForOrder: 'paystack',
      selectedQuote: undefined,
      shippingProvider: undefined,
      snapshot: createCheckoutSnapshot(itemsSnapshot, 35000, 0),
    });

    expect(request.delivery_method).toBe('airport');
    expect(request.selected_quote_id).toBeUndefined();
    expect(request.airport_type).toBe('delivery');
  });
});
