import { describe, expect, it } from 'vitest';
import { resolveOrderShipmentParties } from './resolve-order-shipment-parties';
import type { ShippingAddress } from './types';

const orderReceiver: ShippingAddress = {
  name: 'Ada Customer',
  email: 'ada@example.com',
  phone: '08011111111',
  address: '2 Customer Road',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

const merchantSender: ShippingAddress = {
  name: 'Merchant Store',
  phone: '08022222222',
  address: '1 Merchant Road',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

describe('resolveOrderShipmentParties', () => {
  it('uses the order receiver and merchant sender for domestic bookings', () => {
    const { receiver, sender, items } = resolveOrderShipmentParties({
      bookingContext: { receiver: orderReceiver },
      effectiveQuoteRequest: null,
      isInternationalQuote: false,
      merchantSender,
      orderItems: [{ name: 'Widget', quantity: 2, price: 5000 }],
    });

    expect(receiver).toEqual(orderReceiver);
    expect(sender).toEqual(merchantSender);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 2, value: 5000 });
  });

  it('prefers the stored international receiver while keeping order contact fields', () => {
    const { receiver, sender, items } = resolveOrderShipmentParties({
      bookingContext: { receiver: orderReceiver },
      effectiveQuoteRequest: {
        sessionId: 'session-1',
        sender: merchantSender,
        receiver: {
          ...orderReceiver,
          address: '9 Stored Avenue',
          city: 'Accra',
        },
        items: [],
        shipmentType: 'international',
      },
      isInternationalQuote: true,
      merchantSender,
      orderItems: [{ name: 'Widget', quantity: 1, price: 5000 }],
    });

    expect(receiver).toMatchObject({
      address: '9 Stored Avenue',
      city: 'Accra',
      name: 'Ada Customer',
      email: 'ada@example.com',
      phone: '08011111111',
    });
    expect(sender).toEqual(merchantSender);
    expect(items).toHaveLength(1);
  });

  it('leaves the sender unresolved when neither the quote nor the merchant provides one', () => {
    const { sender } = resolveOrderShipmentParties({
      bookingContext: { receiver: orderReceiver },
      effectiveQuoteRequest: {
        sessionId: 'session-1',
        receiver: orderReceiver,
        items: [],
        shipmentType: 'international',
      },
      isInternationalQuote: true,
      merchantSender: undefined,
      orderItems: [{ name: 'Widget', quantity: 1, price: 5000 }],
    });

    expect(sender).toBeUndefined();
  });
});
