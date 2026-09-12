import { describe, expect, it } from 'vitest';
import {
  buildReceiver,
  OrderShipmentBookingError,
  parseStoredQuoteRequest,
  quotedShipmentItemWeight,
  toDomesticBookingItems,
  toQuoteComparableOrderItems,
  toShipmentItems,
} from './order-shipment-booking-utils';

describe('parseStoredQuoteRequest', () => {
  it('normalizes domestic quote receiver country defaults', () => {
    const parsed = parseStoredQuoteRequest({
      sessionId: 'session-1',
      shipmentType: 'domestic',
      receiver: {
        name: 'Customer',
        phone: '08000000001',
        address: 'Receiver Road',
        city: 'Abuja',
        state: 'Abuja',
        country: '',
        countryCode: '',
      },
      items: [{ name: 'Widget', quantity: 1, weight: 1, value: 5000 }],
    });

    expect(parsed).toMatchObject({
      shipmentType: 'domestic',
      receiver: expect.objectContaining({
        country: 'Nigeria',
        countryCode: 'NG',
      }),
    });
  });

  it('returns null when receiver data is incomplete', () => {
    expect(parseStoredQuoteRequest({ items: [] })).toBeNull();
  });

  it('preserves trusted Admin order provenance during a quote refresh', () => {
    expect(
      parseStoredQuoteRequest({
        sessionId: 'session-1',
        shipmentType: 'domestic',
        admin_order_provenance: 'server_gigl_v1',
        receiver: {
          name: 'Customer',
          phone: '08000000001',
          address: 'Receiver Road',
          city: 'Lagos',
          state: 'Lagos',
        },
        items: [{ name: 'Widget', quantity: 1, weight: 1, value: 5000 }],
      })
    ).toMatchObject({ admin_order_provenance: 'server_gigl_v1' });
  });
});

describe('buildReceiver', () => {
  it('builds a receiver from complete order shipping data', () => {
    expect(
      buildReceiver({
        customer_name: 'Jane Customer',
        customer_email: 'jane@example.com',
        customer_phone: '08012345678',
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        },
      })
    ).toMatchObject({
      name: 'Jane Customer',
      city: 'Toronto',
      state: 'Ontario',
      country: 'Canada',
      countryCode: 'CA',
      postalCode: 'M5V 3L9',
    });
  });

  it('throws when the order shipping address is incomplete', () => {
    expect(() =>
      buildReceiver({
        customer_name: 'Jane Customer',
        customer_email: null,
        customer_phone: null,
        shipping_address: {
          address: '123 Queen Street West',
          city: null,
          state: 'Ontario',
        },
      })
    ).toThrow(OrderShipmentBookingError);
  });
});

describe('quotedShipmentItemWeight', () => {
  it('converts gram product weights to kilograms', () => {
    expect(
      quotedShipmentItemWeight({
        product: { weight_value: 500, weight_unit: 'g' },
      })
    ).toBe(0.5);
  });

  it('ignores unsupported weight units so callers can apply the 1kg quote fallback', () => {
    expect(
      quotedShipmentItemWeight({
        product: { weight_value: 2, weight_unit: 'lb' },
      })
    ).toBeUndefined();
  });

  it('ignores missing product weights so callers can skip the comparison', () => {
    expect(quotedShipmentItemWeight({})).toBeUndefined();
  });
});

describe('toShipmentItems', () => {
  it('maps order items to shipment items with safe defaults', () => {
    expect(
      toShipmentItems([
        { name: 'Widget', quantity: 2, price: '5000' },
        { name: null, quantity: null, price: null },
      ])
    ).toEqual([
      {
        name: 'Widget',
        description: 'Widget',
        quantity: 2,
        weight: 1,
        value: 5000,
      },
      {
        name: 'Order item',
        description: 'Order item',
        quantity: 1,
        weight: 1,
        value: 0,
      },
    ]);
  });
});

describe('toDomesticBookingItems', () => {
  it('reuses attested quote weights instead of the hardcoded 1 kg fallback', () => {
    expect(
      toDomesticBookingItems(
        [{ name: 'Widget', quantity: 1, price: 5000 }],
        [{ name: 'Widget', quantity: 1, weight: 2.5, value: 5000 }]
      )
    ).toEqual([
      {
        name: 'Widget',
        description: 'Widget',
        quantity: 1,
        weight: 2.5,
        value: 5000,
      },
    ]);
  });

  it('falls back to order items when the quote has no attested lines', () => {
    expect(
      toDomesticBookingItems([{ name: 'Widget', quantity: 1, price: 5000 }], [])
    ).toEqual([
      {
        name: 'Widget',
        description: 'Widget',
        quantity: 1,
        weight: 1,
        value: 5000,
      },
    ]);
  });

  it('derives the same 1 kg fallback used by domestic quote construction', () => {
    expect(
      toQuoteComparableOrderItems(
        [{ name: 'Widget', quantity: 1, price: 5000 }],
        { defaultWeight: 1 }
      )
    ).toEqual([{ name: 'Widget', quantity: 1, price: 5000, weight: 1 }]);
  });

  it('includes normalized package dimensions for quote comparison', () => {
    expect(
      toQuoteComparableOrderItems(
        [
          {
            name: 'Widget',
            quantity: 1,
            price: 5000,
            product: {
              weight_value: 1,
              weight_unit: 'kg',
              dimensions: { length: 4, width: 3, height: 2, unit: 'in' },
            },
          },
        ],
        { defaultWeight: 1 }
      )
    ).toEqual([
      {
        name: 'Widget',
        quantity: 1,
        price: 5000,
        weight: 1,
        length: 10.16,
        width: 7.62,
        height: 5.08,
      },
    ]);
  });

  it('bugfix: falls back to top-level item dimensions when product metadata is absent', () => {
    expect(
      toQuoteComparableOrderItems(
        [
          {
            name: 'Widget',
            quantity: 1,
            price: 5000,
            length: 10,
            width: 8,
            height: 6,
          },
        ],
        { defaultWeight: 1 }
      )
    ).toEqual([
      {
        name: 'Widget',
        quantity: 1,
        price: 5000,
        weight: 1,
        length: 10,
        width: 8,
        height: 6,
      },
    ]);
  });
});
