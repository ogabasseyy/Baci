import { describe, expect, it } from 'vitest';
import { buildOrderShipmentBookingRequest } from './build-order-shipment-booking-request';

describe('buildOrderShipmentBookingRequest', () => {
  it('maps the resolved quote and shipment parties to a provider request', () => {
    const sender = {
      name: 'Merchant',
      phone: '08000000000',
      address: '1 Main Street',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
    };
    const receiver = { ...sender, name: 'Customer' };
    const request = buildOrderShipmentBookingRequest({
      items: [{ name: 'Widget', quantity: 1, weight: 1, value: 100 }],
      orderId: 'order-1',
      quote: {
        id: 'quote-1',
        merchant_id: 'merchant-1',
        provider: 'GIGL',
        service_tier: 'GoStandard',
        carrier_name: 'GIG Logistics',
        price: 1000,
        currency: 'NGN',
        estimated_days: 2,
        provider_rate_id: 'GIGL_4_0',
        expires_at: '2099-01-01T00:00:00.000Z',
        quote_request: {},
        provider_metadata: null,
      },
      receiver,
      sender,
    });

    expect(request).toEqual({
      orderId: 'order-1',
      quoteId: 'quote-1',
      providerRateId: 'GIGL_4_0',
      quoteMetadata: null,
      sender,
      receiver,
      items: [{ name: 'Widget', quantity: 1, weight: 1, value: 100 }],
    });
  });
});
