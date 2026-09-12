import type { Order, OrderItem } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import {
  canUseSelectedShippingProvider,
  formatShippingProviderName,
  getDispatchPhoneFromOrder,
  getInitialFulfillmentDetails,
  getOrderGiglInitialAddress,
  orderRequiresFulfillment,
  shouldPersistFulfillmentDetails,
} from '@/lib/order-shipment';

function createItem(overrides: Partial<OrderItem> = {}): OrderItem {
  const name = overrides.name ?? 'iPhone 13';

  return {
    id: 'item-1',
    name,
    price: 500000,
    product_id: 'product-1',
    product_name: name,
    quantity: 1,
    ...overrides,
  };
}

function createOrder(
  overrides: Partial<Order> = {}
): Pick<
  Order,
  | 'selected_quote_id'
  | 'shipment_id'
  | 'shipping_provider'
  | 'tracking_number'
  | 'self_fulfillment_data'
> {
  return {
    selected_quote_id: null,
    shipment_id: null,
    shipping_provider: null,
    tracking_number: null,
    self_fulfillment_data: null,
    ...overrides,
  };
}

describe('order-shipment', () => {
  it('requires fulfillment for insured or device-like items', () => {
    expect(orderRequiresFulfillment([])).toBe(false);
    expect(orderRequiresFulfillment([createItem()])).toBe(true);
    expect(
      orderRequiresFulfillment([
        createItem({ has_assurance: false, name: 'Cotton Hoodie' }),
      ])
    ).toBe(false);
    expect(
      orderRequiresFulfillment([
        createItem({ has_assurance: true, name: 'Cotton Hoodie' }),
      ])
    ).toBe(true);
  });

  it('requires fulfillment for every product sold by electronics merchants', () => {
    expect(
      orderRequiresFulfillment(
        [createItem({ has_assurance: false, name: 'USB-C Cable' })],
        'electronics'
      )
    ).toBe(true);

    expect(
      orderRequiresFulfillment(
        [createItem({ has_assurance: false, name: 'Travel Case' })],
        'GADGETS'
      )
    ).toBe(true);
  });

  it('requires fulfillment for device categories even when the item name has no device keyword', () => {
    expect(
      orderRequiresFulfillment([
        createItem({
          has_assurance: false,
          name: '13-inch Notebook',
          category: 'Laptops',
          category_slug: 'laptops',
        }),
      ])
    ).toBe(true);

    expect(
      orderRequiresFulfillment([
        createItem({
          has_assurance: false,
          name: 'Portable Bluetooth Item',
          category: 'Audio',
          category_slug: 'audio',
        }),
      ])
    ).toBe(true);
  });

  it('allows provider shipment only when a provider quote is still bookable', () => {
    expect(
      canUseSelectedShippingProvider(
        createOrder({
          selected_quote_id: 'quote-1',
          shipping_provider: 'TOPSHIP',
        })
      )
    ).toBe(true);

    expect(
      canUseSelectedShippingProvider(
        createOrder({
          shipping_provider: 'TOPSHIP',
        })
      )
    ).toBe(false);

    expect(
      canUseSelectedShippingProvider(
        createOrder({
          selected_quote_id: 'quote-1',
          shipment_id: 'shipment-1',
          shipping_provider: 'TOPSHIP',
        })
      )
    ).toBe(false);
  });

  it('formats provider names for user-facing copy', () => {
    expect(formatShippingProviderName('TOPSHIP')).toBe('Topship');
    expect(formatShippingProviderName('GIGL')).toBe('GIG Logistics');
    expect(formatShippingProviderName('self_delivery')).toBe('Self Delivery');
    expect(formatShippingProviderName(null)).toBeNull();
  });

  it('hydrates fulfillment details and dispatch phone from persisted order data', () => {
    expect(
      getInitialFulfillmentDetails({
        imei: ' 353456789012345 ',
        serialNumber: ' SN-123 ',
      })
    ).toEqual({
      imei: '353456789012345',
      items: [],
      serialNumber: 'SN-123',
    });

    expect(
      getInitialFulfillmentDetails({
        imei: '',
        serialNumber: ' ',
        serial_number: ' LEGACY-SN ',
      })
    ).toEqual({
      imei: '',
      items: [],
      serialNumber: 'LEGACY-SN',
    });

    expect(
      getDispatchPhoneFromOrder(
        createOrder({
          self_fulfillment_data: {
            dispatchPhone: ' +2348030000000 ',
          },
        })
      )
    ).toBe('+2348030000000');
  });

  it('persists fulfillment details only when at least one field is present', () => {
    expect(
      shouldPersistFulfillmentDetails({ imei: '', items: [], serialNumber: '' })
    ).toBe(false);
    expect(
      shouldPersistFulfillmentDetails({
        imei: '353456789012345',
        items: [],
        serialNumber: 'SN-123',
      })
    ).toBe(true);
    expect(
      shouldPersistFulfillmentDetails({
        imei: '353456789012345',
        items: [],
        serialNumber: '',
      })
    ).toBe(true);
  });

  it('uses only persisted shipping fields for a manual-order GIG quote draft', () => {
    expect(
      getOrderGiglInitialAddress({
        customer_phone: '08010000000',
        shipping_address: {
          address: '1 Allen Avenue',
          city: null,
          state: null,
        },
      })
    ).toEqual({ address: '1 Allen Avenue', phone: '08010000000' });
  });

  it('prefers the shipping recipient phone over the customer phone', () => {
    expect(
      getOrderGiglInitialAddress({
        customer_phone: '08010000000',
        shipping_address: {
          address: '1 Allen Avenue',
          phone: '08020000000',
        },
      })
    ).toEqual({ address: '1 Allen Avenue', phone: '08020000000' });
  });

  it('preserves paired Google coordinates for a coordinate-only shipping address', () => {
    expect(
      getOrderGiglInitialAddress({
        customer_phone: '08010000000',
        shipping_address: {
          address: 'Google place',
          latitude: 6.6018,
          longitude: 3.3515,
        },
      })
    ).toEqual({
      address: 'Google place',
      phone: '08010000000',
      latitude: 6.6018,
      longitude: 3.3515,
    });
  });
});
