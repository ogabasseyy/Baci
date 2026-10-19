import { describe, expect, it } from 'vitest';
import { buildOrderGiglQuoteRequest } from './build-order-gigl-quote-request';

const sender = {
  name: 'Store',
  phone: '0800',
  address: 'Origin',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const base = {
  id: 'o1',
  customer_name: 'Ada',
  customer_phone: '081',
  shipping_address: {
    address: 'Dest',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  order_items: [
    { name: 'iPhone 15', quantity: 1, price: 500000, product_id: 'p1' },
  ],
};

describe('buildOrderGiglQuoteRequest', () => {
  it('converts grams and multiplies quantities', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        order_items: [
          {
            ...base.order_items[0],
            quantity: 2,
            weight_value: 500,
            weight_unit: 'g',
          },
        ],
      },
      sender
    );
    expect(result.ok && result.request.items[0]).toMatchObject({
      weight: 0.5,
      quantity: 2,
    });
  });
  it('uses a 1 kilogram fallback for unusable product weight', async () => {
    const result = await buildOrderGiglQuoteRequest(base, sender, async () => ({
      p1: { weight_value: 0, weight_unit: 'kg' },
    }));
    expect(result.ok && result.request.items).toEqual([
      expect.objectContaining({ name: 'iPhone 15', quantity: 1, weight: 1 }),
    ]);
  });
  it('carries normalized product dimensions onto international quote items', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        shipping_address: {
          ...base.shipping_address,
          country: 'United States',
          countryCode: 'US',
        },
      },
      sender,
      async () => ({
        p1: {
          weight_value: 1,
          weight_unit: 'kg',
          commodity_code: '851712',
          dimensions: { length: 4, width: 3, height: 2, unit: 'in' },
        },
      })
    );

    expect(result.ok && result.request.items[0]).toMatchObject({
      length: 10.16,
      width: 7.62,
      height: 5.08,
      hsCode: '851712',
    });
  });
  it('uses 1 kilogram per unweighted item instead of collapsing a two-item order', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        order_items: [
          { name: 'First item', quantity: 1, price: 100 },
          { name: 'Second item', quantity: 1, price: 200 },
        ],
      },
      sender
    );

    expect(result.ok && result.request.items).toEqual([
      expect.objectContaining({ name: 'First item', quantity: 1, weight: 1 }),
      expect.objectContaining({
        name: 'Second item',
        quantity: 1,
        weight: 1,
      }),
    ]);
    expect(
      result.ok
        ? result.request.items.reduce(
            (sum, item) => sum + item.weight * item.quantity,
            0
          )
        : null
    ).toBe(2);
  });
  it('converts supported imperial units and rejects invalid quantities', async () => {
    const unsupported = await buildOrderGiglQuoteRequest(
      {
        ...base,
        order_items: [
          { ...base.order_items[0], weight_value: 2, weight_unit: 'lb' },
        ],
      },
      sender
    );
    expect(unsupported.ok && unsupported.request.items[0].weight).toBeCloseTo(
      0.90718474,
      8
    );
    const invalid = await buildOrderGiglQuoteRequest(
      { ...base, order_items: [{ ...base.order_items[0], quantity: 1.5 }] },
      sender
    );
    expect(invalid).toMatchObject({
      ok: false,
      code: 'ORDER_SHIPPING_ITEM_INVALID',
    });
  });
  it('reports exact missing receiver fields and rejects empty items', async () => {
    const missing = await buildOrderGiglQuoteRequest(
      { ...base, shipping_address: {} },
      sender
    );
    expect(missing).toMatchObject({
      code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
      missing: ['address', 'city', 'state'],
    });
    const empty = await buildOrderGiglQuoteRequest(
      { ...base, order_items: [] },
      sender
    );
    expect(empty).toMatchObject({ code: 'ORDER_SHIPPING_ITEMS_EMPTY' });
  });

  it('marks a foreign receiver as international instead of using domestic pricing', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        shipping_address: {
          ...base.shipping_address,
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
        },
      },
      sender,
      async () => ({ p1: { commodity_code: '851712' } })
    );

    expect(result).toMatchObject({
      ok: true,
      request: { shipmentType: 'international' },
    });
  });

  it('does not let a default Nigerian code override a foreign country name', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        shipping_address: {
          ...base.shipping_address,
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
        },
      },
      sender,
      async () => ({ p1: { commodity_code: '851712' } })
    );

    expect(result).toMatchObject({
      ok: true,
      request: { shipmentType: 'international' },
    });
  });

  it('propagates product HS codes for international Admin quotes', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        shipping_address: {
          address: '1 King St',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
        },
      },
      sender,
      async () => ({ p1: { commodity_code: '851712' } })
    );

    expect(result.ok && result.request.items[0]).toMatchObject({
      hsCode: '851712',
    });
  });

  it('rejects international Admin quotes when product HS codes are missing', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        shipping_address: {
          address: '1 King St',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
        },
      },
      sender,
      async () => ({ p1: { commodity_code: null } })
    );

    expect(result).toEqual({
      ok: false,
      code: 'ORDER_SHIPPING_HS_CODE_REQUIRED',
      status: 422,
    });
  });

  it('defaults blank domestic country fields to Nigeria before quoting', async () => {
    const result = await buildOrderGiglQuoteRequest(
      {
        ...base,
        shipping_address: {
          ...base.shipping_address,
          country: '',
          countryCode: '',
        },
      },
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        shipmentType: 'domestic',
        receiver: {
          country: 'Nigeria',
          countryCode: 'NG',
        },
      },
    });
  });
});
