import { describe, expect, it } from 'vitest';
import { resolveOrderGiglPreviewTarget } from './order-gigl-preview-target';

const order = {
  customer_phone: '0801',
  id: 'order-1',
  selected_quote_id: null,
  shipment_id: null,
  shipping_address: {
    address: '1 Allen Avenue',
    city: 'Ikeja',
    phone: '',
    state: 'Lagos',
  },
  shipping_funding_source: null,
  shipping_status: 'processing',
  tracking_number: null,
};

describe('resolveOrderGiglPreviewTarget', () => {
  it('returns the same receiver the GIG panel prices, including the phone fallback', () => {
    expect(resolveOrderGiglPreviewTarget(order)).toEqual({
      orderId: 'order-1',
      receiver: {
        address: '1 Allen Avenue',
        city: 'Ikeja',
        phone: '0801',
        state: 'Lagos',
      },
    });
  });

  it('accepts coordinates in place of city and state', () => {
    expect(
      resolveOrderGiglPreviewTarget({
        ...order,
        shipping_address: {
          address: '1 Allen Avenue',
          latitude: 6.6,
          longitude: 3.35,
          phone: '0801',
        },
      })?.receiver
    ).toEqual({
      address: '1 Allen Avenue',
      latitude: 6.6,
      longitude: 3.35,
      phone: '0801',
    });
  });

  it.each([
    ['no order', undefined],
    ['a pending order', { ...order, shipping_status: 'pending' }],
    ['a booked order', { ...order, shipment_id: 'shipment-1' }],
    ['a tracked order', { ...order, tracking_number: 'GIG123' }],
    ['a saved quote', { ...order, selected_quote_id: 'quote-1' }],
    [
      'checkout-funded shipping',
      { ...order, shipping_funding_source: 'customer_checkout' },
    ],
    [
      'a missing city and state without coordinates',
      {
        ...order,
        shipping_address: { address: '1 Allen Avenue', phone: '0801' },
      },
    ],
    ['no delivery or customer phone', { ...order, customer_phone: null }],
  ])('returns null for %s', (_case, candidate) => {
    expect(resolveOrderGiglPreviewTarget(candidate)).toBeNull();
  });
});
