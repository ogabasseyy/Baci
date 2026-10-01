import { describe, expect, it } from 'vitest';
import {
  toInternationalQuoteValidationItemsFromOrder,
  toInternationalShipmentItemsFromOrder,
} from './international-shipment-items';

describe('toInternationalShipmentItemsFromOrder', () => {
  it('converts supported imperial weights instead of defaulting to 1 kg', () => {
    expect(
      toInternationalShipmentItemsFromOrder([
        {
          name: 'Phone',
          quantity: 1,
          price: 100_000,
          product: {
            weight_value: 2,
            weight_unit: 'lb',
            commodity_code: '851712',
          },
        },
      ])
    ).toEqual([
      {
        name: 'Phone',
        description: 'Phone',
        quantity: 1,
        weight: 0.90718474,
        value: 100_000,
        hsCode: '851712',
      },
    ]);
  });

  it('falls back to 1 kilogram for unsupported weight units', () => {
    expect(
      toInternationalShipmentItemsFromOrder([
        {
          name: 'Phone',
          quantity: 1,
          price: 100_000,
          product: {
            weight_value: 2,
            weight_unit: 'stone',
            commodity_code: '851712',
          },
        },
      ])[0]?.weight
    ).toBe(1);
  });

  it('matches buildOrderGiglQuoteRequest for a 2 lb product weight', async () => {
    const { buildOrderGiglQuoteRequest } = await import(
      './build-order-gigl-quote-request'
    );
    const orderItem = {
      name: 'Phone',
      quantity: 1,
      price: 100_000,
      product_id: 'p1',
    };
    const quoteResult = await buildOrderGiglQuoteRequest(
      {
        id: 'order-1',
        customer_name: 'Ada',
        customer_phone: '081',
        shipping_address: {
          address: 'Dest',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        order_items: [orderItem],
      },
      {
        name: 'Store',
        phone: '0800',
        address: 'Origin',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      async () => ({
        p1: { weight_value: 2, weight_unit: 'lb', commodity_code: '851712' },
      })
    );
    const bookedItems = toInternationalShipmentItemsFromOrder(
      [
        {
          ...orderItem,
          product: {
            weight_value: 2,
            weight_unit: 'lb',
            commodity_code: '851712',
          },
        },
      ],
      quoteResult.ok ? quoteResult.request.items : []
    );

    expect(quoteResult.ok && quoteResult.request.items[0].weight).toBeCloseTo(
      0.90718474,
      8
    );
    expect(bookedItems[0]?.weight).toBeCloseTo(0.90718474, 8);
  });

  it('derives international package metadata from the linked product', () => {
    expect(
      toInternationalShipmentItemsFromOrder([
        {
          name: 'Phone',
          quantity: 2,
          price: '100000',
          product: {
            weight_value: '500',
            weight_unit: 'g',
            dimensions: { length: 4, width: 3, height: 2, unit: 'in' },
            commodity_code: '851712',
          },
        },
      ])
    ).toEqual([
      {
        name: 'Phone',
        description: 'Phone',
        quantity: 2,
        weight: 0.5,
        value: 100_000,
        hsCode: '851712',
        length: 10.16,
        width: 7.62,
        height: 5.08,
      },
    ]);
  });

  it('uses conservative order-derived defaults when product metadata is absent', () => {
    expect(
      toInternationalShipmentItemsFromOrder([
        {
          name: 'Custom item',
          quantity: null,
          price: 25_000,
          product: null,
        },
      ])
    ).toEqual([
      {
        name: 'Custom item',
        description: 'Custom item',
        quantity: 1,
        weight: 1,
        value: 25_000,
      },
    ]);
  });

  it('preserves the declared value from the matching quote item', () => {
    expect(
      toInternationalShipmentItemsFromOrder(
        [
          {
            name: 'Phone',
            quantity: 1,
            price: 100_000,
            product: {
              weight_value: 1,
              weight_unit: 'kg',
              commodity_code: '851712',
            },
          },
        ],
        [{ name: 'Phone', quantity: 1, weight: 1, value: 85_000 }]
      )
    ).toEqual([
      {
        name: 'Phone',
        description: 'Phone',
        quantity: 1,
        weight: 1,
        value: 85_000,
        hsCode: '851712',
      },
    ]);
  });

  it('preserves quoted physical metadata when product metadata is absent', () => {
    expect(
      toInternationalShipmentItemsFromOrder(
        [
          {
            name: 'Imported phone',
            quantity: 1,
            price: 100_000,
            product: null,
          },
        ],
        [
          {
            name: 'Imported phone',
            quantity: 1,
            weight: 5,
            value: 85_000,
            hsCode: '851712',
            length: 20,
            width: 12,
            height: 8,
          },
        ]
      )
    ).toEqual([
      {
        name: 'Imported phone',
        description: 'Imported phone',
        quantity: 1,
        weight: 5,
        value: 85_000,
        hsCode: '851712',
        length: 20,
        width: 12,
        height: 8,
      },
    ]);
  });

  it('rejects quote physical metadata that differs from product metadata', () => {
    expect(() =>
      toInternationalShipmentItemsFromOrder(
        [
          {
            name: 'Phone',
            quantity: 1,
            price: 100_000,
            product: {
              weight_value: 1.2,
              weight_unit: 'kg',
              dimensions: { length: 10, width: 8, height: 6, unit: 'cm' },
              commodity_code: '851712',
            },
          },
        ],
        [
          {
            name: 'Phone',
            quantity: 1,
            weight: 0.1,
            value: 85_000,
            hsCode: '851712',
          },
        ]
      )
    ).toThrow('no longer matches the current product shipping details');
  });

  it('consumes each duplicate quote item match only once', () => {
    const orderItems = [
      {
        name: 'Phone',
        quantity: 1,
        price: 100_000,
        product: { weight_value: 1, weight_unit: 'kg' },
      },
      {
        name: 'Phone',
        quantity: 1,
        price: 200_000,
        product: { weight_value: 1, weight_unit: 'kg' },
      },
    ];
    const quoteItems = [
      { name: 'Phone', quantity: 1, weight: 1, value: 90_000 },
      { name: 'Phone', quantity: 1, weight: 1, value: 180_000 },
    ];

    const result = toInternationalShipmentItemsFromOrder(
      orderItems,
      quoteItems
    );

    expect(result).toEqual([
      expect.objectContaining({ weight: 1, value: 90_000 }),
      expect.objectContaining({ weight: 1, value: 180_000 }),
    ]);
  });

  it('rejects invalid order item values instead of defaulting customs value to zero', () => {
    expect(() =>
      toInternationalShipmentItemsFromOrder([
        {
          name: 'Tablet',
          quantity: 1,
          price: 'not-a-number',
          product: {
            weight_value: 1,
            weight_unit: 'kg',
            dimensions: { length: 100, width: 80, height: 60, unit: 'mm' },
          },
        },
      ])
    ).toThrow('invalid price');
  });

  it('normalizes millimeter dimensions', () => {
    expect(
      toInternationalShipmentItemsFromOrder([
        {
          name: 'Tablet',
          quantity: 1,
          price: 150_000,
          product: {
            weight_value: 1,
            weight_unit: 'kg',
            dimensions: { length: 100, width: 80, height: 60, unit: 'mm' },
          },
        },
        {
          name: 'Laptop',
          quantity: 1,
          price: 250_000,
          product: {
            weight_value: 2,
            weight_unit: 'kg',
            dimensions: { length: 10, width: 8, height: 6 },
          },
        },
      ])
    ).toEqual([
      {
        name: 'Tablet',
        description: 'Tablet',
        quantity: 1,
        weight: 1,
        value: 150_000,
        length: 10,
        width: 8,
        height: 6,
      },
      {
        name: 'Laptop',
        description: 'Laptop',
        quantity: 1,
        weight: 2,
        value: 250_000,
        length: 10,
        width: 8,
        height: 6,
      },
    ]);
  });

  it('derives quote validation metadata without requiring item price', () => {
    expect(
      toInternationalQuoteValidationItemsFromOrder([
        {
          name: 'Phone',
          quantity: 1,
          price: null,
          product: {
            weight_value: '500',
            weight_unit: 'g',
            dimensions: { length: 4, width: 3, height: 2, unit: 'in' },
            commodity_code: '851712',
          },
        },
      ])
    ).toEqual([
      {
        name: 'Phone',
        quantity: 1,
        weight: 0.5,
        hsCode: '851712',
        length: 10.16,
        width: 7.62,
        height: 5.08,
      },
    ]);
  });

  it('omits absent physical metadata from quote validation items', () => {
    expect(
      toInternationalQuoteValidationItemsFromOrder([
        {
          name: 'Phone',
          quantity: 1,
          price: null,
          product: null,
        },
      ])
    ).toEqual([
      {
        name: 'Phone',
        quantity: 1,
      },
    ]);
  });

  it('can include order item value for reusable order quote validation', () => {
    expect(
      toInternationalQuoteValidationItemsFromOrder(
        [
          {
            name: 'Phone',
            quantity: 1,
            price: '100000',
            product: null,
          },
        ],
        { includeValue: true }
      )
    ).toEqual([
      {
        name: 'Phone',
        quantity: 1,
        value: 100_000,
      },
    ]);
  });
});
